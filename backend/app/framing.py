"""Common camera transforms for already feasible, source-sized compositions."""

from dataclasses import dataclass
from math import isfinite, log, sqrt
from typing import Literal, Protocol

from app.layout import Box


class CropDirective(Protocol):
    family: str
    horizontal: str
    vertical: str


@dataclass(frozen=True)
class Frame:
    scale: float
    tx: float
    ty: float
    score: float


def frame_candidates(
    boxes: list[Box],
    families: list[str],
    roles: dict[str, str],
    width: float,
    height: float,
    *,
    mode: Literal["fit", "close", "bleed"] = "fit",
    focus: str | None = None,
    crop: CropDirective | None = None,
    variant: int = 0,
    max_scale: float = 4,
) -> list[Frame]:
    """Rank up to six cameras; lower scores are better.

    Coordinates are ``screen = translation + source * scale``. This function
    never moves or resizes an individual object: world-space relationships and
    original relative dimensions therefore survive every camera choice.

    Visibility here is a rectangular screen-area guard, not an
    alpha/silhouette measurement. The caller retains responsibility for checking
    that explicit contact points remain in view.
    """
    if not boxes or len(boxes) != len(families):
        raise ValueError("Camera needs one source box per family")
    if mode not in {"fit", "close", "bleed"}:
        raise ValueError("Unknown framing mode")
    if not all(isfinite(value) and value > 0 for value in (width, height, max_scale)):
        raise ValueError("Camera dimensions and scale must be positive and finite")
    if any(
        not all(isfinite(v) for v in (b.x, b.y, b.width, b.height)) or b.width <= 0 or b.height <= 0
        for b in boxes
    ):
        raise ValueError("Source boxes must have finite coordinates and positive dimensions")

    left, top = min(b.x for b in boxes), min(b.y for b in boxes)
    span_w = max(b.x + b.width for b in boxes) - left
    span_h = max(b.y + b.height for b in boxes) - top
    margin = min(width, height) * (0.085 + variant * 0.015)
    fit_scale = min(max_scale, (width - 2 * margin) / span_w, (height - 2 * margin) / span_h)
    fit = Frame(
        fit_scale,
        (width - span_w * fit_scale) / 2 - left * fit_scale,
        (height - span_h * fit_scale) / 2 - top * fit_scale,
        0.0,
    )
    if mode == "fit":
        return [fit]

    main = [i for i, family in enumerate(families) if roles.get(family) != "background"]
    # A wholly decorative scene still needs a visible, readable focal object.
    primary = main or list(range(len(boxes)))
    biggest = max(primary, key=lambda i: boxes[i].width * boxes[i].height)
    focus_index = families.index(focus) if focus in families else biggest
    crop_index = families.index(crop.family) if crop and crop.family in families else None
    areas = [b.width * b.height for b in boxes]
    largest_source = max(areas)
    weights = [sqrt(areas[i]) for i in primary]
    visual_cx = sum(
        (boxes[i].x + boxes[i].width / 2) * w for i, w in zip(primary, weights, strict=True)
    ) / sum(weights)
    visual_cy = sum(
        (boxes[i].y + boxes[i].height / 2) * w for i, w in zip(primary, weights, strict=True)
    ) / sum(weights)
    centers = [
        (left + span_w / 2, top + span_h / 2),
        (visual_cx, visual_cy),
        (
            boxes[focus_index].x + boxes[focus_index].width / 2,
            boxes[focus_index].y + boxes[focus_index].height / 2,
        ),
    ]
    focal_x = (0.5, 0.43, 0.57)[variant % 3]
    focal_y = (0.5, 0.47, 0.53)[variant % 3]
    min_large = 0.75 if mode == "close" else 0.55
    min_focus = 0.70 if mode == "close" else 0.45
    frames = {}

    for zoom in (0.75, 0.9, 1.0, 1.05, 1.12, 1.25, 1.4, 1.6, 1.8, 2.1):
        scale = min(max_scale, fit_scale * zoom)
        xs = {width / 2 - cx * scale + width * dx for cx, _ in centers for dx in (-0.12, 0, 0.12)}
        ys = {height / 2 - cy * scale + height * dy for _, cy in centers for dy in (-0.12, 0, 0.12)}
        if crop_index is not None:
            target = boxes[crop_index]
            # Add edge-directed cameras explicitly; these values are generic
            # fractions of the selected object's own dimensions.
            for amount in (0.08, 0.16, 0.26):
                if crop.horizontal == "left":
                    xs.add(-target.x * scale - target.width * scale * amount)
                elif crop.horizontal == "right":
                    xs.add(width - (target.x + target.width * (1 - amount)) * scale)
                if crop.vertical == "top":
                    ys.add(-target.y * scale - target.height * scale * amount)
                elif crop.vertical == "bottom":
                    ys.add(height - (target.y + target.height * (1 - amount)) * scale)
        for tx in sorted(xs):
            for ty in sorted(ys):
                visible, main_visible_area, main_center_visible = [], 0.0, False
                for i, box in enumerate(boxes):
                    x, y = tx + box.x * scale, ty + box.y * scale
                    w, h = box.width * scale, box.height * scale
                    clipped = max(0, min(width, x + w) - max(0, x)) * max(
                        0, min(height, y + h) - max(0, y)
                    )
                    fraction = clipped / (w * h)
                    visible.append(fraction)
                    if i in primary:
                        main_visible_area += clipped
                        main_center_visible |= 0 <= x + w / 2 <= width and 0 <= y + h / 2 <= height
                    minimum = 0.28
                    if i in main:
                        minimum = (
                            0.98
                            if areas[i] <= largest_source * 0.22
                            else (min_focus if i == focus_index else min_large)
                        )
                    if fraction + 1e-9 < minimum:
                        break
                else:
                    if not main_center_visible:
                        continue
                    if crop_index is not None:
                        box = boxes[crop_index]
                        x, y = tx + box.x * scale, ty + box.y * scale
                        right, bottom = x + box.width * scale, y + box.height * scale
                        horizontal = crop.horizontal
                        vertical = crop.vertical
                        crosses = (
                            (horizontal != "left" or x < -1e-6)
                            and (horizontal != "right" or right > width + 1e-6)
                            and (vertical != "top" or y < -1e-6)
                            and (vertical != "bottom" or bottom > height + 1e-6)
                        )
                        if horizontal not in {"left", "right"} and vertical not in {
                            "top",
                            "bottom",
                        }:
                            crosses = (
                                x < -1e-6
                                or y < -1e-6
                                or right > width + 1e-6
                                or bottom > height + 1e-6
                            )
                        if not crosses:
                            continue
                    # Prefer a substantial, balanced illustration. Close framing
                    # penalizes unnecessary clipping more strongly than bleed.
                    occupancy = min(1, main_visible_area / (width * height))
                    balance = ((tx + visual_cx * scale) / width - focal_x) ** 2 + (
                        (ty + visual_cy * scale) / height - focal_y
                    ) ** 2
                    crop_loss = sum(
                        (1 - visible[i]) * w for i, w in zip(primary, weights, strict=True)
                    ) / sum(weights)
                    target_occupancy = 0.58 if mode == "close" else 0.72
                    score = (
                        1.4 * (occupancy - target_occupancy) ** 2
                        + 0.8 * balance
                        + (1.6 if mode == "close" else 0.45) * crop_loss
                        - (0.12 if mode == "close" else 0.25) * log(scale / fit_scale)
                    )
                    frame = Frame(scale, tx, ty, score)
                    frames[(scale, tx, ty)] = frame
    # A failed camera request must rank below feasible requested framing when
    # the caller compares several independently packed layouts.
    fallback = Frame(fit.scale, fit.tx, fit.ty, 10.0)
    return sorted(frames.values(), key=lambda f: (f.score, f.scale, f.tx, f.ty))[:6] or [fallback]
