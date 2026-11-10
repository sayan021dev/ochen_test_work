# Custom Shadow Implementation Plan

> Execution: superpowers:executing-plans, native implementation; user approved feature and main pushes.

**Goal:** optional per-object vector shadow controls without changing default artwork.
**Architecture:** reviewed shadow path metadata in catalog; optional Scene parameters; identical SVG transforms in preview/export.
**Tech Stack:** existing Python/FastAPI/Pydantic, React/TypeScript/native SVG.
**Spec:** ../specs/2026-11-10-custom-shadow-design.md

## Global constraints

Original SVG bytes/path data unchanged. Default mode identical. No SVG filters/raster.
Scope only custom shadows, direct main commits as authorized. No paid AI calls.

## Review focus

Combined outline/shadow paths; duplicate IDs; role/S/L changes; old JSON projects;
locked elements and undo/redo; preview/export transform parity.

## Task 1: Reviewed catalog and export
- [x] Identify source shadow nodes/subpaths for all 40 variants, inspect contact sheet.
- [x] Red tests: metadata points to real contours, standard paths unchanged, optional shadow transforms/opacity and schema bounds.
- [x] Implement optional model and vector export using shared catalog parameters.
- [x] Run pytest/Ruff and commit.

## Task 2: UI and browser regressions
- [x] Red Vitest/Playwright tests for preview, opt-in controls, undo, role/S/L, persistence, export and restore original.
- [x] Implement separate inspector section and preview parity; preserve main workflow.
- [x] Run full checks and Playwright, visually inspect result.
- [x] Commit/push, verify main, restart local app, report exact scope and checks.

## Verification and review

- RED→GREEN: optional Scene schema/export, pen contact point, coin sidewall, memoization, clamped fields.
- Whole feature reviewer: custom_shadow_review. Confirmed all 40 baseline exports byte-identical to 117601c, all source hashes intact, and TS/Python DOM parity for all 40 before final refinement.
- Important fixes: body contact anchor/hull bounds, closed coin contour and headphone depth, stable Artwork props, accurate projection copy. UI label/coordinate/clamp findings treated as current-feature correctness and fixed in the same pass.
- Frozen candidate: 128 pytest tests, 13 Vitest tests, 13 Playwright scenarios pass; branch-inclusive Python coverage 94%.
- No default source paths/files altered; no paid AI calls. Final push/remote and Docker smoke checked at delivery.
