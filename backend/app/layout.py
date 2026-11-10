"""Validated spatial intent and deterministic packing of unmodified source rectangles.

Relations describe instances by catalog family: V1 allows one instance per family.
All sizes stay in source units until one common scale fits the whole composition.
"""

import re
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from pydantic import Field, model_validator

from app.art_direction import (
    ArtDirection,
    mentions,
    parse_art_direction,
    resolve_art_direction,
    strip_art_directives,
)
from app.models import Family, Model

RelationKind = Literal["left_of", "right_of", "above", "below", "on", "behind", "in_front_of"]


class LayoutRelation(Model):
    subject: Family
    relation: RelationKind
    targets: list[Family] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def no_self_reference(self):
        if self.subject in self.targets:
            raise ValueError("Предмет не может располагаться относительно самого себя")
        return self


class LayoutIntent(Model):
    relations: list[LayoutRelation] = Field(max_length=30)
    art: ArtDirection | None = None


RELATIONS = {
    "left_of": r"слева(?:\s+от)?|левее(?:\s+от)?|to\s+the\s+left\s+of|left\s+of",
    "right_of": r"справа(?:\s+от)?|правее(?:\s+от)?|to\s+the\s+right\s+of|right\s+of",
    "above": r"над|выше|сверху(?:\s+от)?|above|over",
    "below": r"под|ниже|снизу(?:\s+от)?|below|under|beneath",
    "on": r"на|on(?:\s+top\s+of)?",
    "behind": r"позади|сзади(?:\s+от)?|за|behind",
    "in_front_of": r"перед|впереди(?:\s+от)?|in\s+front\s+of",
}
REL_RE = re.compile(r"\b(?:" + "|".join(f"(?P<{r}>{p})" for r, p in RELATIONS.items()) + r")\b")
CONNECTOR = re.compile(r"^\s*(?:(?:,\s*)?(?:и|and|&)\s*|,\s*)$")
GROUP_PRONOUN = re.compile(r"\b(?:ними|них|ими|ними|them|both|всеми|всех)\b")
SINGLE_PRONOUN = re.compile(r"\b(?:ней|ним|него|нее|ею|нем|it)\b")


def _art_clause_boundaries(original: str, stripped: str, nouns) -> set[int]:
    """Retain independent art clauses that space-preserving stripping would hide.

    A single decorated noun on either side of a comma is an independent clause.
    Oblique single-word adjectives still decorate genuine lists of targets, e.g.
    'на книге, фоновой лампе'. Explicit conjunction groups are handled by callers.
    """
    separators = [-1, *(m.start() for m in re.finditer(r"[,;\n]", original)), len(original)]
    boundaries = set()
    for start, end in pairwise(separators):
        clause_nouns = [noun for noun in nouns if start < noun.start() < end]
        if len(clause_nouns) != 1 or original[start + 1 : end] == stripped[start + 1 : end]:
            continue
        if REL_RE.search(stripped[start + 1 : end]):
            continue
        removed = "".join(
            char if char != stripped[index] else " "
            for index, char in enumerate(original[start + 1 : end], start + 1)
        )
        words = re.findall(r"[а-я]+", removed)
        if len(words) == 1 and re.fullmatch(
            r"[а-я]+(?:ой|ому|ым|ыми|ого|ую|ей|ом|ых|их)", words[0]
        ):
            continue
        boundaries.update((start, end))
    return boundaries


def parse_layout_intent(prompt: str, families: list[str]) -> LayoutIntent:
    """Recognize literal RU/EN instructions; broader language can come from the LLM."""
    original_text = prompt.lower().replace("ё", "е")
    text = strip_art_directives(prompt)
    nouns = [m for m in mentions(text) if m.lastgroup in families]
    art_boundaries = _art_clause_boundaries(original_text, text, nouns)

    def separate_art_clauses(before, after):
        gap = text[before.end() : after.start()]
        if re.search(r"\b(?:и|and)\b|&", gap):
            return False
        return any(before.end() <= boundary < after.start() for boundary in art_boundaries)

    relations = []
    last_subjects: list[str] = []
    for index in range(len(nouns) - 1):
        before, after = nouns[index], nouns[index + 1]
        gap = text[before.end() : after.start()]
        matches = [
            m for m in REL_RE.finditer(gap) if not re.search(r"\b(?:не|not)\s*$", gap[: m.start()])
        ]
        if not matches:
            # Inverted clause: 'над книгой монета' / 'слева от монеты книга'.
            prefix = text[: before.start()] if index == 0 else ""
            prefix_matches = list(REL_RE.finditer(prefix))
            if prefix_matches and (
                not gap.strip()
                or re.fullmatch(
                    r"\s*(?:стоит|стоят|лежит|лежат|sits?|stands?|lies?|rests?)\s*", gap
                )
            ):
                relation = prefix_matches[-1]
                relations.append(
                    LayoutRelation(
                        subject=after.lastgroup,
                        relation=relation.lastgroup,
                        targets=[before.lastgroup],
                    )
                )
                last_subjects = [after.lastgroup]
            continue
        match = matches[-1]
        subject = [before.lastgroup]
        targets = [after.lastgroup]
        # A new inverted clause must not borrow its subject from the previous clause:
        # 'над книгой монета, справа от книги телефон'. Here the second 'книга'
        # is the reference and the next adjacent noun is the new subject.
        clause_boundary = re.search(
            r"(?:[,;]\s*(?:а\s+|and\s+)?|(?:и|and)\s+)$", gap[: match.start()]
        )
        predicate = (
            text[after.end() : nouns[index + 2].start()].strip() if index + 2 < len(nouns) else None
        )
        next_is_subject = predicate is not None and (
            not predicate
            or re.fullmatch(
                r"(?:стоит|стоят|лежит|лежат|расположен[а-я]*|находится|находятся|"
                r"sits?|stands?|lies?|rests?|is\s+lying)",
                predicate,
            )
        )
        if clause_boundary and next_is_subject:
            subject, targets = [nouns[index + 2].lastgroup], [after.lastgroup]
        # 'пазл на монете, а под ними книга': the noun after the pronoun is subject.
        elif GROUP_PRONOUN.search(gap[match.end() :]):
            subject, targets = (
                [after.lastgroup],
                list(dict.fromkeys(n.lastgroup for n in nouns[: index + 1])),
            )
        elif SINGLE_PRONOUN.search(gap[match.end() :]):
            subject, targets = [after.lastgroup], [before.lastgroup]
        elif re.search(r"[,;]\s*(?:а\s+|and\s+)?$", gap[: match.start()]) and not re.search(
            r"\b(?:от|of)\s*$", match.group()
        ):
            subject, targets = [after.lastgroup], [before.lastgroup]
        else:
            # Consecutive conjunctions form a group on either side of the relation.
            left = index
            while left > 0 and CONNECTOR.fullmatch(
                text[nouns[left - 1].end() : nouns[left].start()]
            ):
                if separate_art_clauses(nouns[left - 1], nouns[left]):
                    break
                connector = text[nouns[left - 1].end() : nouns[left].start()]
                if "," in connector and any(
                    r.subject == nouns[left - 1].lastgroup or nouns[left - 1].lastgroup in r.targets
                    for r in relations
                ):
                    break
                left -= 1
            subject = list(dict.fromkeys(n.lastgroup for n in nouns[left : index + 1]))
            right = index + 1
            while right + 1 < len(nouns) and CONNECTOR.fullmatch(
                text[nouns[right].end() : nouns[right + 1].start()]
            ):
                if separate_art_clauses(nouns[right], nouns[right + 1]):
                    break
                following_end = nouns[right + 2].start() if right + 2 < len(nouns) else len(text)
                following = text[nouns[right + 1].end() : following_end]
                if REL_RE.search(following):
                    # 'folder behind headphones, pen below them': pen opens its own
                    # clause rather than becoming a second target of 'behind'.
                    break
                right += 1
            targets = list(dict.fromkeys(n.lastgroup for n in nouns[index + 1 : right + 1]))
            if re.match(r"^\s*(?:и|and)\s+", gap) and last_subjects:
                subject = last_subjects
        last_subjects = subject
        for family in subject:
            selected = [t for t in targets if t != family]
            if selected:
                relations.append(
                    LayoutRelation(subject=family, relation=match.lastgroup, targets=selected)
                )
    # A corrective clause can refer back without repeating an object: 'не под ..., а над ней'.
    if len(nouns) >= 2:
        tail = text[nouns[-1].end() :]
        corrections = list(REL_RE.finditer(tail))
        if corrections and GROUP_PRONOUN.search(tail):
            targets = list(
                dict.fromkeys(n.lastgroup for n in nouns[:-1] if n.lastgroup != nouns[-1].lastgroup)
            )
            if targets:
                relations.append(
                    LayoutRelation(
                        subject=nouns[-1].lastgroup,
                        relation=corrections[-1].lastgroup,
                        targets=targets,
                    )
                )
        if corrections and SINGLE_PRONOUN.search(tail):
            match = corrections[-1]
            if not re.search(r"\b(?:не|not)\s*$", tail[: match.start()]):
                if re.search(r"[,;]", tail[: match.start()]):
                    # 'coin not below book, but above it': correct the prior subject.
                    subjects = last_subjects or [nouns[-2].lastgroup]
                    reference = nouns[-1].lastgroup
                else:
                    # 'coin left of book, phone right of it': phone is a new subject.
                    subjects = [nouns[-1].lastgroup]
                    reference = nouns[-2].lastgroup
                for subject in subjects:
                    if subject != reference:
                        relations.append(
                            LayoutRelation(
                                subject=subject, relation=match.lastgroup, targets=[reference]
                            )
                        )
    art = parse_art_direction(prompt, families)
    return LayoutIntent(relations=relations, art=art if art != ArtDirection() else None)


def resolve_intent(prompt: str, families: list[str], proposed: LayoutIntent | None) -> LayoutIntent:
    literal = parse_layout_intent(prompt, families)
    allowed = set(families)
    contact = {"on", "behind", "in_front_of"}
    axes = {"left_of": "x", "right_of": "x", "above": "y", "below": "y"}
    inferred = []
    for relation in proposed.relations if proposed else []:
        if relation.subject not in allowed:
            continue
        targets = []
        for target in relation.targets:
            if target not in allowed:
                continue
            pair = {relation.subject, target}
            conflicts = any(
                pair == {explicit.subject, reference}
                and (
                    relation.relation in contact
                    or explicit.relation in contact
                    or axes.get(relation.relation) == axes.get(explicit.relation)
                )
                for explicit in literal.relations
                for reference in explicit.targets
            )
            if not conflicts:
                targets.append(target)
        if targets:
            inferred.append(
                LayoutRelation(
                    subject=relation.subject, relation=relation.relation, targets=targets
                )
            )
    art = resolve_art_direction(prompt, families, proposed.art if proposed else None)
    return LayoutIntent(
        relations=inferred + literal.relations, art=art if art != ArtDirection() else None
    )


@dataclass
class Box:
    x: float
    y: float
    width: float
    height: float


def _coordinates(count, edges):
    values = [0.0] * count
    for _step in range(count + 1):
        changed = False
        for source, target, distance in edges:
            if values[target] < values[source] + distance - 1e-7:
                values[target] = values[source] + distance
                changed = True
        if not changed:
            return values
    return None


def pack(
    dimensions: list[dict],
    families: list[str],
    intent: LayoutIntent,
    aspect: float,
    variant: int,
    *,
    _flexible_overlap: bool = False,
) -> tuple[list[Box], list[str]]:
    """Pack source bounds using difference constraints and explicit contact groups.

    Non-contact groups have disjoint complete SVG bounds, including original shadows.
    Only 'on/behind/in_front_of' permits intersection of the specified pair.
    """
    n = len(families)
    lookup = {family: i for i, family in enumerate(families)}
    widths = [a["width"] for a in dimensions]
    heights = [a["height"] for a in dimensions]
    gap = max(max(widths), max(heights)) * (0.045 + variant * 0.012)
    contact = [r for r in intent.relations if r.relation in {"on", "behind", "in_front_of"}]
    # Prefer the established centered contact composition. If it cannot satisfy
    # the request, behind/front may slide while preserving visible intersection.
    xedges, yedges = [], []
    zedges = []
    contact_offsets = {}
    supports = {}
    for relation in contact:
        if relation.relation == "on" and len(relation.targets) == 1:
            supports.setdefault(lookup[relation.targets[0]], []).append(lookup[relation.subject])
    for support, subjects in supports.items():
        subjects = list(dict.fromkeys(subjects))
        if len(subjects) < 2:
            continue
        row_width = sum(widths[i] for i in subjects) + gap * (len(subjects) - 1)
        start = (widths[support] - row_width) / 2
        if len(subjects) == 2 and row_width > widths[support]:
            # Both may overhang a smaller support, while their inner edges still
            # visibly touch it and the two subjects remain completely separate.
            start = widths[support] / 2 - gap / 2 - widths[subjects[0]]
        for subject in subjects:
            contact_offsets[(subject, support)] = start
            start += widths[subject] + gap
    # A bridge can rest on several separate supports. Distribute those supports
    # under its footprint instead of forcing their centers to coincide.
    for relation in contact:
        if relation.relation != "on" or len(relation.targets) < 2:
            continue
        owner = lookup[relation.subject]
        receivers = [lookup[target] for target in dict.fromkeys(relation.targets)]
        row_width = sum(widths[i] for i in receivers) + gap * (len(receivers) - 1)
        start = (widths[owner] - row_width) / 2
        if len(receivers) == 2 and row_width > widths[owner]:
            start = widths[owner] / 2 - gap / 2 - widths[receivers[0]]
        for receiver in receivers:
            contact_offsets[(owner, receiver)] = -start
            start += widths[receiver] + gap
    for r in contact:
        i = lookup[r.subject]
        for target in r.targets:
            j = lookup[target]
            dx = contact_offsets.get((i, j), (widths[j] - widths[i]) / 2)
            dy = (
                -heights[i] + min(heights[i], heights[j]) * 0.50
                if r.relation == "on"
                else (heights[j] - heights[i]) / 2 - min(heights[i], heights[j]) * 0.15
            )
            if r.relation == "on" and dimensions[i].get("contact") and dimensions[j].get("contact"):
                foot = dimensions[i]["contact"]["contact"]
                surface = dimensions[j]["contact"]["surface"]
                if (i, j) not in contact_offsets:
                    dx = surface[0] - foot[0]
                dy = surface[1] - foot[1]
            if _flexible_overlap and r.relation != "on":
                overlap_x = min(widths[i], widths[j]) * 0.05
                overlap_y = min(heights[i], heights[j]) * 0.05
                xedges.extend([(j, i, overlap_x - widths[i]), (i, j, overlap_x - widths[j])])
                yedges.extend([(j, i, overlap_y - heights[i]), (i, j, overlap_y - heights[j])])
            else:
                xedges.extend([(j, i, dx), (i, j, -dx)])
                yedges.extend([(j, i, dy), (i, j, -dy)])
            zedges.append((i, j) if r.relation == "behind" else (j, i))
    for r in intent.relations:
        i = lookup[r.subject]
        for target in r.targets:
            j = lookup[target]
            if r.relation == "left_of":
                xedges.append((i, j, widths[i] + gap))
            elif r.relation == "right_of":
                xedges.append((j, i, widths[j] + gap))
            elif r.relation == "above":
                yedges.append((i, j, heights[i] + gap))
            elif r.relation == "below":
                yedges.append((j, i, heights[j] + gap))
    allowed = {frozenset((lookup[r.subject], lookup[t])) for r in contact for t in r.targets}

    def solve(xe, ye):
        xs, ys = _coordinates(n, xe), _coordinates(n, ye)
        if xs is None or ys is None:
            return None

        def center_components(values, extents, edges, align_kinds):
            # Translate only whole unconstrained components; every inequality and
            # contact equality therefore remains exact. Packing below rechecks all pairs.
            remaining = set(range(n))
            groups = []
            while remaining:
                group = {min(remaining)}
                for _ in range(n):
                    group |= {a for a, b, _distance in edges if b in group}
                    group |= {b for a, b, _distance in edges if a in group}
                remaining -= group
                start = min(values[i] for i in group)
                span = max(values[i] + extents[i] for i in group) - start
                groups.append((group, start, span))
            total = max(span for _, _, span in groups)
            centered = list(values)
            for group, start, span in groups:
                for i in group:
                    centered[i] += (total - span) / 2 - start
            # A free object above/below a specific reference should align with that
            # reference, not with an unrelated extension of the entire composition.
            # Only move singleton components: existing constraints never change.
            free = {next(iter(group)) for group, _, _ in groups if len(group) == 1}
            preferences = {}
            for relation in intent.relations:
                i = lookup[relation.subject]
                if relation.relation in align_kinds and len(relation.targets) == 1 and i in free:
                    preferences.setdefault(i, lookup[relation.targets[0]])
            for _ in range(n):
                for i, j in preferences.items():
                    centered[i] = centered[j] + (extents[j] - extents[i]) / 2
            return centered

        xs = center_components(xs, widths, xe, {"above", "below"})
        ys = center_components(ys, heights, ye, {"left_of", "right_of"})
        return [Box(x, y, w, h) for x, y, w, h in zip(xs, ys, widths, heights, strict=True)]

    def score(boxes):
        w = max(b.x + b.width for b in boxes) - min(b.x for b in boxes)
        h = max(b.y + b.height for b in boxes) - min(b.y for b in boxes)
        # Minimize the limiting dimension on this actual canvas, then whitespace.
        return max(w / aspect, h) + 0.035 * (w / aspect + h)

    boxes = solve(xedges, yedges)
    if boxes is None:
        if not _flexible_overlap and any(r.relation != "on" for r in contact):
            return pack(dimensions, families, intent, aspect, variant, _flexible_overlap=True)
        raise ValueError(
            "Противоречивое размещение предметов. Уточните пространственные отношения."
        )
    # A separating edge stays true forever, so at most n(n-1)/2 iterations are needed.
    for _ in range(n * (n - 1) // 2):
        collision = next(
            (
                (i, j)
                for i in range(n)
                for j in range(i + 1, n)
                if frozenset((i, j)) not in allowed
                and min(boxes[i].x + widths[i], boxes[j].x + widths[j])
                > max(boxes[i].x, boxes[j].x) - gap * 0.3
                and min(boxes[i].y + heights[i], boxes[j].y + heights[j])
                > max(boxes[i].y, boxes[j].y) - gap * 0.3
            ),
            None,
        )
        if collision is None:
            break
        i, j = collision
        choices = [
            ("x", i, j, widths[i] + gap),
            ("y", i, j, heights[i] + gap),
            ("x", j, i, widths[j] + gap),
            ("y", j, i, heights[j] + gap),
        ]
        choices = choices[variant:] + choices[:variant]
        options = []
        for axis, source, target, distance in choices:
            xe = xedges + ([(source, target, distance)] if axis == "x" else [])
            ye = yedges + ([(source, target, distance)] if axis == "y" else [])
            result = solve(xe, ye)
            if result is not None:
                options.append((score(result), xe, ye, result))
        if not options:
            if not _flexible_overlap and any(r.relation != "on" for r in contact):
                return pack(dimensions, families, intent, aspect, variant, _flexible_overlap=True)
            raise ValueError("Не удалось разместить предметы без наложений. Уточните отношения.")
        _, xedges, yedges, boxes = min(options, key=lambda item: item[0])
    if _flexible_overlap:
        # When one backdrop overlaps a group, individually centered contacts may
        # be incompatible with that group's own axial relations. Prefer the
        # union's center instead of the minimal solver's top-left pile, but only
        # if every hard edge (including non-contact separation) remains true.
        for relation in contact:
            if relation.relation == "on":
                continue
            i = lookup[relation.subject]
            targets = [boxes[lookup[t]] for t in relation.targets]
            cx = (min(b.x for b in targets) + max(b.x + b.width for b in targets)) / 2
            cy = (min(b.y for b in targets) + max(b.y + b.height for b in targets)) / 2
            source = boxes[i]
            for x, y in (
                (cx - source.width / 2, cy - source.height / 2),
                (cx - source.width / 2, source.y),
                (source.x, cy - source.height / 2),
            ):
                candidate = list(boxes)
                candidate[i] = Box(x, y, source.width, source.height)
                if all(candidate[b].x >= candidate[a].x + d - 1e-7 for a, b, d in xedges) and all(
                    candidate[b].y >= candidate[a].y + d - 1e-7 for a, b, d in yedges
                ):
                    boxes = candidate
                    break
    # Topological ordering keeps a placed-on object above its support, regardless of roles.
    order = list(range(n))
    for _ in range(n):
        for before, after in zedges:
            if order.index(before) > order.index(after):
                order.remove(before)
                order.insert(order.index(after), before)
    if any(order.index(a) > order.index(b) for a, b in zedges):
        raise ValueError("Противоречивый порядок слоев")
    return boxes, [families[i] for i in order]
