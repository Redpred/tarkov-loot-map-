"""Create reproducible ZIP64 resource packages from a dedicated staging folder."""
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
target = pathlib.Path(sys.argv[2]).resolve()
root_name = sys.argv[3] if len(sys.argv) > 3 else source.name
readme = pathlib.Path(sys.argv[4]).read_bytes() if len(sys.argv) > 4 else None
if not root_name or root_name in (".", "..") or "/" in root_name or "\\" in root_name:
    raise SystemExit("Invalid archive root")
if target.exists():
    raise SystemExit("Refusing to overwrite an existing resource archive")
with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
    for file in sorted(source.rglob("*")):
        if file.is_symlink():
            raise SystemExit("Resource packages cannot contain symbolic links")
        if not file.is_file():
            continue
        relative = file.relative_to(source).as_posix()
        if readme is not None and relative == "使用说明.txt":
            continue
        info = zipfile.ZipInfo(root_name + "/" + relative, (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info._compresslevel = 1
        info.external_attr = 0o100644 << 16
        with file.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
            while chunk := reader.read(1024 * 1024):
                writer.write(chunk)
    if readme is not None:
        info = zipfile.ZipInfo(root_name + "/使用说明.txt", (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, readme, compresslevel=1)
