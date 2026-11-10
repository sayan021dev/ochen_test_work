"""Extract original Figma groups without editing a single path command.

Run from repository root: python scripts/import_catalog.py
The two section SVGs were exported through Figma Desktop with IDs enabled.
"""

import copy
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
INDICES = {
    "L": {
        "book": (12, 13),
        "phone": (14, 15),
        "puzzle": (5, 6),
        "coin": (26, 27),
        "headphones": (16, 17),
        "lamp": (18, 19),
        "flowers": (36, 37),
        "wallet": (20, 21),
        "folder": (24, 25),
        "pen": (22, 23),
    },
    "S": {
        "book": (10, 19),
        "phone": (11, 20),
        "puzzle": (12, 21),
        "coin": (13, 22),
        "headphones": (14, 23),
        "lamp": (15, 24),
        "flowers": (2, 3),
        "wallet": (18, 27),
        "folder": (16, 25),
        "pen": (17, 26),
    },
}
TAGS = {
    "book": ["книга", "книги", "знания", "учеба", "обучение", "читать", "book", "books"],
    "phone": ["телефон", "телефоны", "связь", "общение", "технологии", "phone"],
    "puzzle": ["пазл", "пазлы", "система", "решение", "команда", "puzzle"],
    "coin": ["монета", "монеты", "деньги", "доход", "финансы", "coin"],
    "headphones": ["наушники", "музыка", "фокус", "концентрация", "headphones"],
    "lamp": ["лампа", "свет", "идея", "работа", "lamp"],
    "flowers": ["цветы", "букет", "ваза", "рост", "забота", "flowers"],
    "wallet": ["кошелек", "кошельки", "бюджет", "сбережения", "wallet"],
    "folder": ["папка", "папки", "документы", "порядок", "организация", "folder"],
    "pen": ["ручка", "ручки", "письмо", "творчество", "записи", "pen"],
}
PALETTES = [
    {
        "id": "lilac",
        "name": "Сирень",
        "background": ["#D7CDF5", "#AA9BF0", "#7864D7", "#181817"],
        "object": ["#F9ECB0", "#F9A3AA", "#FFE3E1", "#FFFFFF"],
    },
    {
        "id": "peach",
        "name": "Персик",
        "background": ["#FDD7B9", "#FAC896", "#D27532", "#181817"],
        "object": ["#F9ECB0", "#80DADA", "#BEEBEB", "#FFFFFF"],
    },
    {
        "id": "aqua",
        "name": "Аквамарин",
        "background": ["#BEEBEB", "#80DADA", "#5ABEBE", "#181817"],
        "object": ["#FFD4F2", "#6D7BFC", "#B6C6FE", "#FFFFFF"],
    },
]


def main():
    entries = json.loads((ROOT / "assets/source-map.json").read_text())
    sections = {d: ET.parse(ROOT / f"assets/originals/library-{d}.svg").getroot() for d in "LS"}
    destination = ROOT / "assets/library"
    destination.mkdir(exist_ok=True)
    assets = []
    for entry in entries:
        family, detail, role = entry["family"], entry["detail"], entry["role"]
        index = INDICES[detail][family][role == "background"]
        source = sections[detail]
        subject = source[0][index]
        actual_name = subject.get("id").encode("latin1").decode("utf8")
        assert actual_name.removesuffix("_2") == entry["sourceName"], (entry, actual_name)
        width, height = entry["width"], entry["height"]
        svg = ET.Element(
            f"{{{NS}}}svg",
            {
                "viewBox": f"0 0 {width} {height}",
                "width": str(width),
                "height": str(height),
                "fill": "none",
            },
        )
        wrapper = ET.SubElement(
            svg, f"{{{NS}}}g", {"transform": f"translate({-entry['x']} {-entry['y']})"}
        )
        additional = []
        if family == "book" and detail == "L":
            wrapper.append(copy.deepcopy(source[0][10 if role == "main" else 11]))
            additional = ["21:29952" if role == "main" else "24:6272"]
        wrapper.append(copy.deepcopy(subject))
        # The section's unused white clip rectangle is not illustration artwork.
        references = re.findall(r"url\(#([^)]+)\)", ET.tostring(wrapper, encoding="unicode"))
        for element in source:
            if references and element.tag == f"{{{NS}}}defs":
                svg.append(copy.deepcopy(element))
        identifier = f"{detail.lower()}-{role}-{family}"
        content = ET.tostring(svg, encoding="utf-8", xml_declaration=True)
        relative_file = f"library/{identifier}.svg"
        (ROOT / "assets" / relative_file).write_bytes(content)
        assets.append(
            {
                "id": identifier,
                "family": family,
                "name": entry["label"],
                "detail": detail,
                "role": role,
                "width": width,
                "height": height,
                "source_node_id": entry["nodeId"],
                "additional_source_node_ids": additional,
                "source_file": f"originals/library-{detail}.svg",
                "source_group": actual_name,
                "source_file_sha256": hashlib.sha256(
                    (ROOT / f"assets/originals/library-{detail}.svg").read_bytes()
                ).hexdigest(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "file": relative_file,
                "tags": TAGS[family],
            }
        )
    (ROOT / "assets/catalog.json").write_text(
        json.dumps(
            {
                "version": 1,
                "source": "https://www.figma.com/design/dnuDZosHkN6ajkhiVfavRw/",
                "assets": assets,
                "palettes": PALETTES,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"Extracted {len(assets)} original vector assets")


if __name__ == "__main__":
    main()
