"""Small versioned source catalog; no Figma dependency at runtime."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSET_ROOT = ROOT / "assets"
_manifest = json.loads((ASSET_ROOT / "catalog.json").read_text())
SHADOWS = json.loads((ASSET_ROOT / "shadow-map.json").read_text())
CONTACTS = json.loads((ASSET_ROOT / "contact-map.json").read_text())
CATALOG = [
    {**asset, "shadow": SHADOWS[asset["id"]], "contact": CONTACTS[asset["id"]]}
    for asset in _manifest["assets"]
]
PALETTES = _manifest["palettes"]
FAMILIES = list(dict.fromkeys(asset["family"] for asset in CATALOG))


def asset_for(family: str, detail: str, role: str) -> dict:
    for asset in CATALOG:
        if (asset["family"], asset["detail"], asset["role"]) == (family, detail, role):
            return {**asset, "svg": (ASSET_ROOT / asset["file"]).read_text()}
    raise ValueError("Неизвестный объект библиотеки")


def public_catalog() -> list[dict]:
    return [{**asset, "url": f"/assets/{asset['file']}"} for asset in CATALOG]
