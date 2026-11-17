"""Re-download the known public distribution; archive bytes, HTTP evidence and hashes.

Capture: python scripts/archive_upstream.py docs/upstream/YYYY-MM-DD
Offline verification: python scripts/archive_upstream.py docs/upstream/YYYY-MM-DD --verify
Only Python's standard library is required. Existing snapshots are never overwritten.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ENTRY = "https://www.bilibili.com/toy/golden-hour/index.html"
REPO = "https://api.github.com/repos/LankiYang/golden-hour"
PERMISSION = "https://github.com/user-attachments/assets/44a7cc57-4f56-40a9-9d06-63b2ac29da3e"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, expected_status=200):
    statuses = (expected_status,) if isinstance(expected_status, int) else expected_status
    request = Request(url, headers={"User-Agent": "GoldenHour-SourceArchive/1.0",
                                   "Accept-Encoding": "identity"})
    try:
        response = urlopen(request, timeout=60)
    except HTTPError as error:
        if error.code not in statuses:
            raise
        response = error
    with response:
        body = response.read()
        if body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)
        if response.status not in statuses:
            raise ValueError(f"Unexpected HTTP {response.status}: {url}")
        return body, {
            "url": url, "finalURL": response.geturl(), "httpStatus": response.status,
            "retrievedAtUTC": datetime.now(timezone.utc).isoformat(),
            "headers": {key: response.headers[key] for key in (
                "Date", "Content-Type", "Content-Length", "Content-Encoding",
                "ETag", "Last-Modified", "Cache-Control") if key in response.headers},
            "bytes": len(body), "sha256": sha(body),
        }


class Frames(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag == "iframe" and dict(attrs).get("src"):
            self.urls.append(dict(attrs)["src"])


def verify(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    archive = folder / manifest["archive"]["file"]
    assert sha(archive.read_bytes()) == manifest["archive"]["sha256"], "ZIP hash"
    with zipfile.ZipFile(archive) as package:
        assert package.testzip() is None, "ZIP CRC"
        rows = manifest["resources"]
        assert len(package.namelist()) == len(rows), "ZIP member count"
        assert set(package.namelist()) == {row["file"] for row in rows}, "ZIP members"
        for row in rows:
            body = package.read(row["file"])
            assert len(body) == row["bytes"] and sha(body) == row["sha256"], row["file"]
            if row["file"].endswith(".js"):
                for ref in re.findall(r'''["'](\.{1,2}/[^"'\s]+?\.js)["']''', body.decode("utf-8")):
                    resolved = urljoin(row["finalURL"], ref)
                    assert any(item["url"] == resolved for item in rows), (row["file"], ref)
        entry = package.read("original/entry.html").decode("utf-8")
        core = next(row for row in rows if row["file"] == "game/dist/game.js")
        assert f'data-bundle="{core["sha256"]}"' in entry, "Entry/core bundle identity"
    print(f"Verified {len(rows)} resources, ZIP CRC, SHA-256 and relative JS dependency closure.")


def capture(folder):
    if folder.exists():
        raise FileExistsError(f"Use a new snapshot directory: {folder}")
    sources = json.loads((ROOT / "docs/sources.json").read_text(encoding="utf-8"))
    shell, shell_meta = fetch(ENTRY)
    frames = Frames()
    frames.feed(shell.decode("utf-8"))
    game_url, = [url for url in frames.urls if url.startswith(
        "https://www.bilibilitoy.com/toy/golden-hour/") and url.endswith("/index.html")]
    base = game_url.removesuffix("index.html")
    old_base = next(row["upstreamURL"] for row in sources if row["resource"] == "original/entry.html").removesuffix("index.html")
    jobs = [(row["resource"], row["upstreamURL"].replace(old_base, base), 200, row) for row in sources
            if row["resource"] != "original/bilibili.html"]
    jobs += [
        ("platform/manifest.webmanifest", urljoin(ENTRY, "manifest.webmanifest"), 200, None),
        ("platform/sw.js", urljoin(ENTRY, "sw.js"), 200, None),
        ("reference/upstream-repository.json", REPO, (200, 404), None),
        ("reference/author.json", "https://api.github.com/users/LankiYang", 200, None),
        ("reference/fork-permission.png", PERMISSION, 200, None),
    ]

    def download(job):
        name, url, status, old = job
        body, meta = fetch(url, status)
        if name.endswith(".json") or name.endswith(".webmanifest"):
            json.loads(body)
        if name.endswith(".png"):
            assert body.startswith(b"\x89PNG\r\n\x1a\n"), name
        if name.endswith(".js") or name.endswith(".css"):
            assert "text/html" not in meta["headers"].get("Content-Type", ""), name
        meta["file"] = name
        if old:
            meta["previousSha256"] = old["upstreamSha256"]
            meta["matchesPrevious"] = meta["sha256"] == old["upstreamSha256"]
        print(f"HTTP {meta['httpStatus']} {name}: {len(body)} bytes", flush=True)
        return body, meta

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(download, jobs))
    old_shell = next(row for row in sources if row["resource"] == "original/bilibili.html")
    shell_meta.update(file="original/bilibili.html", previousSha256=old_shell["upstreamSha256"],
                      matchesPrevious=sha(shell) == old_shell["upstreamSha256"])
    results.append((shell, shell_meta))
    folder.mkdir(parents=True)
    archive = folder / "resources.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for body, meta in sorted(results, key=lambda item: item[1]["file"]):
            info = zipfile.ZipInfo(meta["file"])
            package.writestr(info, body, compress_type=zipfile.ZIP_DEFLATED)
    manifest = {
        "entryURL": ENTRY, "gameURL": game_url, "bundleVersion": base.rstrip("/").rsplit("/", 1)[1],
        "completedAtUTC": datetime.now(timezone.utc).isoformat(),
        "bodyEncoding": "HTTP content-decoded bytes; no newline or character normalization",
        "scope": "Known 42-file distribution plus platform PWA files, public GitHub metadata and maintainer-linked permission image. No accounts, saves, analytics SDKs or backend session requests.",
        "permission": "Maintainer confirms author consent for fork/development; formal open-source license remains unspecified. See reference/fork-permission.png.",
        "archive": {"file": archive.name, "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes())},
        "resources": [meta for _, meta in sorted(results, key=lambda item: item[1]["file"])],
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    verify(folder)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    (verify if args.verify else capture)(args.folder)
