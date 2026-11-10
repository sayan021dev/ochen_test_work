"""Catch incomplete extraction, invented assets and loss of source geometry."""

import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
NS = {"s": "http://www.w3.org/2000/svg"}


def test_all_original_families_have_true_detail_and_role_variants():
    manifest_path = ROOT / "assets/catalog.json"
    assert manifest_path.exists(), "Catalog extraction has not been implemented"
    assets = json.loads(manifest_path.read_text())["assets"]
    assert len(assets) == 40
    for family in {a["family"] for a in assets}:
        variants = [a for a in assets if a["family"] == family]
        assert {(a["detail"], a["role"]) for a in variants} == {
            ("L", "main"),
            ("L", "background"),
            ("S", "main"),
            ("S", "background"),
        }
        for asset in variants:
            content = (ROOT / "assets" / asset["file"]).read_bytes()
            assert hashlib.sha256(content).hexdigest() == asset["sha256"]
            svg = ET.fromstring(content)
            assert svg.findall(".//s:path", NS)
            assert not svg.findall(".//s:image", NS)
            assert asset["source_node_id"]


def test_book_keeps_loose_source_contours_and_lamp_is_not_redrawn():
    manifest_path = ROOT / "assets/catalog.json"
    assert manifest_path.exists(), "Catalog extraction has not been implemented"
    assets = json.loads(manifest_path.read_text())["assets"]
    book = next(a for a in assets if a["id"] == "l-main-book")
    assert book["additional_source_node_ids"] == ["21:29952"]
    source = ET.parse(ROOT / "assets/originals/library-L.svg").getroot()
    original_lamp = next(
        g for g in source[0] if g.get("id", "").encode("latin1").decode("utf8") == "Лампа"
    )
    lamp = ET.parse(ROOT / "assets/library/l-main-lamp.svg").getroot()
    assert [p.get("d") for p in lamp.findall(".//s:path", NS)] == [
        p.get("d") for p in original_lamp.findall(".//s:path", NS)
    ]


def test_custom_shadow_metadata_covers_exact_catalog_and_binds_to_source_hashes():
    from app.catalog import CATALOG

    metadata = json.loads((ROOT / "assets/shadow-map.json").read_text())
    assert set(metadata) == {a["id"] for a in CATALOG}
    for a in CATALOG:
        entry = metadata[a["id"]]
        ids = {n.get("id") for n in ET.parse(ROOT / "assets" / a["file"]).getroot().iter()}
        assert entry["source_sha256"] == a["sha256"]
        assert entry["body_path_ids"] and set(entry["body_path_ids"]) <= ids
        assert set(entry.get("erase_path_ids", [])) <= ids
        assert entry["width"] > 0 and entry["height"] > 0


def test_diagonal_pen_shadow_anchor_is_on_its_body_hull():
    import math

    from app.catalog import CATALOG

    for asset in CATALOG:
        if asset["family"] != "pen":
            continue
        meta = asset["shadow"]
        assert min(math.dist(meta["anchor"], point) for point in meta["hull"]) < 0.01
