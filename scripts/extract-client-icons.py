"""Export Texture2D/Sprite images from an already verified project snapshot.

This exports actual Unity image objects; it does not render 3-D item thumbnails
or invent mappings between texture names and quest/trader database IDs.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def safe_name(value):
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")[:80] or "image"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--match", default=".*", help="Image object name regular expression")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    snapshot, output = Path(args.snapshot).resolve(), Path(args.out).resolve()
    if not snapshot.is_relative_to(root / "work") or not output.is_relative_to(root / "work"):
        parser.error("Snapshot and fresh output must be inside project work/")
    if output == snapshot or output.is_relative_to(snapshot) or output.exists():
        parser.error("Use a new independent output directory")
    manifest = json.loads((snapshot / "client-snapshot.json").read_text(encoding="utf-8"))
    if manifest.get("type") != "eft-client-snapshot":
        parser.error("Create a snapshot with client:snapshot first")
    files = []
    for entry in manifest["files"]:
        relative = Path(entry["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid snapshot member")
        file = snapshot / relative
        if file.is_symlink() or not file.resolve().is_relative_to(snapshot):
            raise ValueError("Linked snapshot member")
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                raise ValueError("Snapshot changed: " + entry["path"])
        # Resource data is consumed as a dependency, never parsed on its own.
        if file.name.endswith((".assets", ".bundle")) or re.fullmatch(r"level\d+", file.name):
            files.append((entry, file))
    import UnityPy
    output.mkdir(parents=True)
    rows, failures, skipped, seen = [], [], [], set()
    pattern = re.compile(args.match)
    for entry, file in files:
        environment = UnityPy.load(str(file))
        for obj in environment.objects:
            if obj.type.name not in ("Texture2D", "Sprite"):
                continue
            identity = (entry["path"], obj.assets_file.name, obj.path_id, obj.type.name)
            if identity in seen:
                continue
            seen.add(identity)
            try:
                data = obj.read()
                name = str(getattr(data, "m_Name", ""))
                if not pattern.search(name):
                    continue
                # Dynamic font atlases have no serialized pixels. They are not
                # missing resource streams and cannot be exported as images.
                if (obj.type.name == "Texture2D" and data.m_Width == 0
                        and data.m_Height == 0 and not data.image_data
                        and not data.m_StreamData.path and data.m_StreamData.size == 0):
                    skipped.append({"sourceFile": entry["path"], "pathId": obj.path_id,
                                    "name": name, "reason": "empty-runtime-texture"})
                    continue
                image = data.image
                stem = hashlib.sha256((entry["sha256"] + repr(identity)).encode()).hexdigest()[:16]
                relative = safe_name(name) + "-" + stem + ".png"
                target = output / relative
                image.save(target)
                rows.append({"file": relative, "name": name, "type": obj.type.name,
                             "width": image.width, "height": image.height,
                             "sourceFile": entry["path"], "sourceSha256": entry["sha256"],
                             "assetFile": obj.assets_file.name, "pathId": obj.path_id,
                             "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
            except Exception as error:
                failures.append({"sourceFile": entry["path"], "pathId": obj.path_id,
                                 "type": obj.type.name, "error": str(error)})
        print(json.dumps({"source": entry["path"], "images": len(rows), "failures": len(failures)}), flush=True)
    report = {"schemaVersion": 1, "images": rows, "failures": failures, "skipped": skipped,
              "note": "Local extraction only; no redistribution license is granted."}
    (output / "images.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if failures or not rows:
        raise SystemExit("Image extraction incomplete; inspect images.json")


if __name__ == "__main__":
    main()
