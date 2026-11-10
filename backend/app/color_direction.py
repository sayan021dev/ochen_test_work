"""Named paints affect a reviewed source surface, never all SVG fills.

Source classification is exact palette-role metadata shared by the S/L variants.
RGB distance is used only to resolve a requested color name inside the active
palette. A palette without that hue therefore produces its closest allowed color,
without introducing a new hex value or rewriting the original illustration.
"""

from typing import Literal, cast

from app.art_direction import ColorName
from app.models import Family, PaintRole, Palette

# Reviewed against both source detail sets. The book's pages and flower vase stay
# white; the phone's broad screen is its colored face, rather than its thin edge.
_PRIMARY_SURFACE: dict[Family, PaintRole] = {
    "book": "object-0",
    "phone": "object-0",
    "puzzle": "object-0",
    "coin": "object-0",
    "headphones": "background-0",
    "lamp": "object-1",
    "flowers": "object-1",
    "wallet": "background-0",
    "folder": "object-0",
    "pen": "object-1",
}
_COLOR_ANCHORS: dict[ColorName, tuple[int, int, int]] = {
    "yellow": (255, 213, 79),
    "pink": (255, 105, 180),
    "blue": (65, 105, 225),
    "green": (76, 175, 80),
    "orange": (255, 152, 0),
    "purple": (156, 88, 205),
    "red": (239, 83, 80),
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "gray": (128, 128, 128),
}


def color_map_for(
    family: Family,
    role: Literal["main", "background"],
    color_name: ColorName,
    palette: Palette,
) -> dict[PaintRole, PaintRole]:
    """Map one exact source role to the nearest permitted active-palette slot."""
    source = _PRIMARY_SURFACE[family] if role == "main" else "background-0"
    target_rgb = _COLOR_ANCHORS[color_name]
    groups = ("background", "object") if role == "main" else ("background",)
    candidates = [
        (cast(PaintRole, f"{group}-{index}"), color)
        for group in groups
        for index, color in enumerate(getattr(palette, group))
    ]

    def distance(candidate: tuple[PaintRole, str]) -> int:
        color = candidate[1]
        return sum(
            (int(color[1 + channel * 2 : 3 + channel * 2], 16) - target_rgb[channel]) ** 2
            for channel in range(3)
        )

    return {source: min(candidates, key=distance)[0]}
