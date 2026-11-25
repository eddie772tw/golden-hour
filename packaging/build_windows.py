"""Build both Windows x64 player archives from the current Git commit. Python 3.11+, Git and 7-Zip."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NODE = "24.22.3"
GIT = "2.56.1"
SERVER_GAME = (
    "client/local-account.js", "client/weapon-models.js", "client/weapon-wire.js", "client/m200.js",
    "client/simulation.js",
    "client/net.js", "client/api-config.js", "client/server-target.js", "client/webrtc.js", "i18n/errors.js", "i18n/zh-CN.js",
)
SERVER = ("server.mjs", "original-gateway.mjs", "admission.mjs", "ballistics.mjs", "career.mjs", "room.mjs",
          "visibility.mjs", "world.json", "maps.mjs", "room-content.mjs", "bot-navigation.mjs",
          "dedicated/launch.mjs", "dedicated/portable.mjs")


def fetch(cache, url, algorithm, digest):
    target = cache / url.rsplit("/", 1)[1]
    def valid(path):
        with path.open("rb") as src:
            return hashlib.file_digest(src, algorithm).hexdigest() == digest
    if target.exists() and valid(target):
        return target
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
        download = Path(tmp.name)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, download.open("wb") as out:
            shutil.copyfileobj(response, out)
        if not valid(download):
            raise ValueError(f"Checksum mismatch: {url}")
        download.replace(target)
    finally:
        download.unlink(missing_ok=True)
    return target


def runtime_files(cache, staging, lock):
    node = f"node-v{NODE}-win-x64"
    archive = fetch(cache, f"https://nodejs.org/dist/v{NODE}/{node}.zip", "sha256",
                    "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f")
    with zipfile.ZipFile(archive) as z:
        files = {"runtime/node.exe": z.read(node+"/node.exe"), "licenses/node-LICENSE": z.read(node+"/LICENSE")}
    portable_git = fetch(cache, f"https://github.com/git-for-windows/git/releases/download/v{GIT}.windows.1/PortableGit-{GIT}-64-bit.7z.exe",
                         "sha256", "9dd04a608ceb5f6ab32a73709e0ecb159d211da71b697c45ff81f6dd0c6b49c7")
    members = {f"ucrt64/bin/{name}": f"runtime/{name}" for name in
               ("openssl.exe", "libcrypto-3-x64.dll", "libssl-3-x64.dll")}
    members["ucrt64/share/licenses/openssl/LICENSE"] = "licenses/openssl-LICENSE"
    seven = shutil.which("7z") or Path(os.environ["ProgramFiles"]) / "7-Zip/7z.exe"
    subprocess.run([seven, "x", "-y", f"-o{staging}", portable_git, *members], check=True, stdout=subprocess.DEVNULL)
    files.update({dest: (staging/src).read_bytes() for src, dest in members.items()})
    files["runtime/openssl.cnf"] = b"[req]\ndistinguished_name = dn\n[dn]\n"
    # Pull only the locked Windows runtime and licenses. No install scripts or local node_modules.
    for name, wanted in {
        "node-datachannel": ("package.json","LICENSE","dist/esm/"),
        "@node-datachannel/win32-x64-msvc": ("package.json","node_datachannel.node"),
        "detect-libc": ("package.json","LICENSE","lib/"),
    }.items():
        dest = f"node_modules/{name}/"
        pkg = lock["packages"][dest.rstrip("/")]
        algorithm, encoded = pkg["integrity"].split("-",1)
        archive = fetch(cache, pkg["resolved"], algorithm, base64.b64decode(encoded).hex())
        with tarfile.open(archive, "r:gz") as tar:
            for item in tar.getmembers():
                path = item.name.removeprefix("package/")
                if item.isfile() and (path in wanted or any(path.startswith(p) for p in wanted if p.endswith("/"))):
                    files[dest+path] = tar.extractfile(item).read()
    return files


def pack(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(path.stem+"/"+name)  # fixed timestamp
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)


def upstream_files(repo, archive, staging):
    source = staging / "upstream-source"
    repo.extractall(source)
    files = {}
    for script, prefix in (
        ("import_maps.py", "game/assets/maps"),
        ("import-v60115-m200.py", "game/assets/upstream-weapons/v60115"),
    ):
        importer = source / "scripts" / script
        if not importer.is_file():
            continue
        subprocess.run([sys.executable, importer, archive], cwd=source, check=True)
        for path in (source / prefix).rglob("*"):
            if path.is_file():
                files[path.relative_to(source).as_posix()] = path.read_bytes()
    if not files:
        raise ValueError("No v60115 asset importer produced files from this commit")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT/"dist")
    parser.add_argument("--cache", type=Path, default=Path(os.environ["LOCALAPPDATA"])/"GoldenHourBuild")
    parser.add_argument("--upstream-archive", type=Path,
                        help="optionally import verified v60115 assets for a local Windows build")
    args = parser.parse_args()
    upstream = args.upstream_archive.resolve(strict=True) if args.upstream_archive else None
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    source = subprocess.check_output(["git","archive","--format=zip",commit],cwd=ROOT)
    with tempfile.TemporaryDirectory(dir=args.output) as tmp, zipfile.ZipFile(io.BytesIO(source)) as repo:
        tmp = Path(tmp)
        common = runtime_files(args.cache, tmp, json.loads(repo.read("package-lock.json")))
        common.update({"server/"+p: repo.read("server/"+p) for p in SERVER})
        for name in ("package.json","package-lock.json","docs/provenance.md","docs/sources.json"):
            common[name] = repo.read(name)
        for name in repo.namelist():
            if not name.startswith("docs/licenses/") or name.endswith("/"):
                continue
            common[name] = repo.read(name)
        common["README.txt"] = repo.read("packaging/windows/README.txt")
        common["VERSION.txt"] = f"Golden Hour {commit}\nWindows x64\nNode {NODE}\nOpenSSL from PortableGit {GIT}.windows.1\n".encode()
        optional = upstream_files(repo, upstream, tmp) if upstream else {}
        if upstream:
            with upstream.open("rb") as archive:
                digest = hashlib.file_digest(archive, "sha256").hexdigest()
            common["VERSION.txt"] += f"v60115 archive SHA-256 {digest}\n".encode()
        sums = []
        for role, cmd in (("Client","Play.cmd"),("Dedicated-Server","Start-Server.cmd")):
            files = dict(common)
            paths = ([p for p in repo.namelist() if p.startswith("game/") and not p.endswith("/")]
                     if role=="Client" else ["game/"+p for p in SERVER_GAME])
            files.update({p:repo.read(p) for p in paths})
            if role == "Client":
                files.update(optional)
            else:
                files.update({name: data for name, data in optional.items()
                              if name.startswith("game/assets/maps/") and name.endswith(".json")})
            files[cmd] = repo.read("packaging/windows/"+cmd)
            out = tmp / f"Golden-Hour-{role}-Windows-x64.zip"
            pack(out, files)
            with out.open("rb") as stream:
                sums.append(hashlib.file_digest(stream,"sha256").hexdigest()+"  "+out.name)
        (tmp/"SHA256SUMS.txt").write_bytes(("\n".join(sums)+"\n").encode())
        for product in [*sorted(tmp.glob("*.zip")), tmp/"SHA256SUMS.txt"]:
            product.replace(args.output/product.name)
        print("\n".join(sums))


if __name__ == "__main__":
    main()
