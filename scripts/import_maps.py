"""Import the locked v60115 map assets from a local source archive."""
import argparse
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile


ARCHIVE_HASH = "e1e886a88f152246725b9d808c84f94034c301582c5bd042506e587dc6ab5116"
ASSETS = {
    "catalog.json": "a249a37044e7e4b1f302230f88ab1b277db16621cac7bb6c638e7c2654f27a08",
    "hotel/2/gameplay.json": "5d3376eaf63671763f300415f23b62d57511710f1bac1f42bb1bf2ed15f90074",
    "hotel/2/manifest.json": "bb14011c124616569522443cebad04a89a7a9463e030b268dd959bb8055dc0d0",
    "hotel/2/world.json": "e1011fef7266be0db6a4be56344143e8ece2294c54ba525786fd5eca47ef287b",
    "shipment/3/gameplay.json": "1501761dab660e92f63a415b77d93d525b1a923d563ebf7b6ca54805868a1e1a",
    "shipment/3/manifest.json": "5c1a161d11b915a0a372105841deb3d962081da394699f8d0a9bf49e4a380e49",
    "shipment/3/scene.glb": "13b15cc09396b6d0eb5c59caef8a2d3cac018e8675e644172c5cafc24814c55b",
    "shipment/3/world.json": "7691b78078b28266f85d315ed450fe102b5e94a2bde7c365bfd1a9b7bacfc2aa",
    "sublevel-07/4/gameplay.json": "4203711f566457b15d8eaf4015ca509efd018345010fc0ad5a360227cb69a6f8",
    "sublevel-07/4/manifest.json": "eac12d0c1dbbe0b4378292c02fb234c163d8f52dd67a33044c833d7504ce32f3",
    "sublevel-07/4/scene.glb": "0720ca184b4a12009186a8b9e643218ff08a90c370d54bb4e6a03dd6976f14cb",
    "sublevel-07/4/world.json": "1b6c2b2385d1ffa5a23912afc6cc4dd704b21e532ff4bac4db79fd5c794c7b80",
}
PREFIX = "game/assets/maps"


def import_maps(archive, repo):
    with archive.open("rb") as source:
        digest = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
        if digest.hexdigest() != ARCHIVE_HASH:
            raise ValueError("Archive SHA-256 differs from the v60115 source lock")
        source.seek(0)
        with ZipFile(source) as zip_file:
            payloads = {name: zip_file.read(f"{PREFIX}/{name}") for name in ASSETS}

    for name, data in payloads.items():
        if hashlib.sha256(data).hexdigest() != ASSETS[name]:
            raise ValueError(f"Asset SHA-256 differs from the source lock for {name}")

    root = repo / PREFIX
    root.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=root) as staging:
        staged = Path(staging)
        for name, data in payloads.items():
            path = staged / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        # Publish the catalog after all versions have their verified files.
        for name in [name for name in payloads if name != "catalog.json"] + ["catalog.json"]:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            (staged / name).replace(target)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Local v60115 resources.zip")
    args = parser.parse_args()
    try:
        root = import_maps(args.archive, Path(__file__).resolve().parents[1])
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        parser.exit(1, f"{error}\n")
    print(f"Imported {len(ASSETS)} verified assets to {root}")
