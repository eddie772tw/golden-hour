"""Install the optional M200 model from the exact v60115 source archive."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile


ARCHIVE_DIGEST = "e1e886a88f152246725b9d808c84f94034c301582c5bd042506e587dc6ab5116"
MODEL_DIGEST = "36bd0514bba47fbe688899076b6c13419096a34f7a11b27346eadabf5b894b73"
ENTRY = "game/assets/models/m200.glb"
DEST = Path(__file__).resolve().parents[1] / "game/assets/upstream-weapons/v60115/m200.glb"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    with args.archive.open("rb") as archive:
        if hashlib.file_digest(archive, "sha256").hexdigest() != ARCHIVE_DIGEST:
            parser.error("archive SHA-256 does not match the locked v60115 source")
        archive.seek(0)
        with ZipFile(archive) as source:
            data = source.read(ENTRY)
    if hashlib.sha256(data).hexdigest() != MODEL_DIGEST:
        parser.error("M200 GLB SHA-256 does not match the locked v60115 model")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temp = DEST.with_suffix(".tmp")
    temp.write_bytes(data)
    temp.replace(DEST)
    print(f"{DEST}  {MODEL_DIGEST}")


if __name__ == "__main__":
    main()
