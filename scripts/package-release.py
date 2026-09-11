"""Package only the self-contained runtime and marketplace files for distribution."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
plugin = root / "plugins/weft-plugin"
version = json.loads((plugin / "package.json").read_text())["version"]
release = f"weft-plugin-{version}"
out = root / "releases"
out.mkdir(exist_ok=True)
archive = out / f"{release}.zip"
files = [root / ".claude-plugin/marketplace.json", root / "README.md", root / "LICENSE",
         plugin / ".claude-plugin/plugin.json", plugin / ".mcp.json", plugin / "README.md"]
for directory in ("commands", "hooks", "mcp-server", "skills"):
    files.extend(p for p in (plugin / directory).rglob("*") if p.is_file())
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for path in sorted(files):
        bundle.write(path, f"{release}/{path.relative_to(root)}")
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
print(f"Created {archive} ({len(files)} files)")
