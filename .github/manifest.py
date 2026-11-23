"""Builds the Jellyfin plugin catalog manifest (and release notes) from build.yaml."""
import datetime
import hashlib
import json
import re
import sys


def read_build_yaml():
    text = open("build.yaml", encoding="utf-8").read()
    data = {}
    for key in ("name", "guid", "targetAbi", "overview", "category", "owner"):
        m = re.search(rf'^{key}:\s*"(.*)"\s*$', text, re.M)
        data[key] = m.group(1) if m else ""
    for key in ("description", "changelog"):
        m = re.search(rf"^{key}:\s*>\s*\n((?:[ \t]+.*\n?)+)", text, re.M)
        data[key] = " ".join(line.strip() for line in m.group(1).splitlines()) if m else ""
    return data


meta = read_build_yaml()

if sys.argv[1:] == ["--notes"]:
    print(meta["changelog"])
    print()
    print("Install from the plugin catalog: add this repository in Dashboard → Plugins → Repositories:")
    print()
    print("https://github.com/isaacAmejia/JellyStream/releases/latest/download/manifest.json")
    sys.exit(0)

version, zip_path, repo = sys.argv[1], sys.argv[2], sys.argv[3]
checksum = hashlib.md5(open(zip_path, "rb").read()).hexdigest()
zip_name = zip_path.rsplit("/", 1)[-1]

manifest = [{
    "guid": meta["guid"],
    "name": meta["name"],
    "overview": meta["overview"],
    "description": meta["description"],
    "owner": meta["owner"],
    "category": meta["category"],
    "imageUrl": "",
    "versions": [{
        "version": version,
        "changelog": meta["changelog"],
        "targetAbi": meta["targetAbi"],
        "sourceUrl": f"https://github.com/{repo}/releases/download/v{version}/{zip_name}",
        "checksum": checksum,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }],
}]
print(json.dumps(manifest, indent=2))
