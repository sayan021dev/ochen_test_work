# Silhouette Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Replace custom footprint distortion with a proportionate vector silhouette projected from a fixed ground line.
**Architecture:** Reviewed ground metadata feeds identical Python/TS affine projection. Ordinary source splitting remains intact. Canvas uses the projection vector for direct manipulation rather than independently translating the shadow.
**Tech Stack:** FastAPI/Python, React/TypeScript, native SVG, pytest/Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-silhouette-shadow-design.md

## Global Constraints

Original SVG bytes unchanged. No paid calls. No arbitrary silhouette width stretch. All scene shadows under bodies. Work on main, commit/push finished steps.

## Review Focus

All 10 families including tiny coin and perforated headphones; body base occlusion; singular edge-on projection; rotated/nonuniform owner; historical saved shadow offsets.

### Task 1: SVG projection engine and contract tests

Files: backend/app/shadow.py, frontend/src/shadow.ts, their tests and native renderer E2E.
Interfaces: shadowMatrix/shadow_matrix return the custom projection matrix from metadata; with_custom_shadow/applyCustomShadow keep explicit preserve_source behavior for ordinary split.
- [x] Assert fixed ground endpoints, silhouette proportions and no old footprint/mesh; run red.
- [x] Implement black silhouette projection, mask with unprojected body and preserve vector holes; run targeted tests.
- [x] Compare Python/TS output and visually inspect all families.

### Task 2: Ground metadata

Files: assets/shadow-map.json, scripts/prepare_shadow_metadata.mjs, frontend/src/types.ts.
- [x] Derive/review lower body support line and silhouette bbox for all 40 variants, retaining source hashes.
- [x] Validate metadata and repeat preparation reproducibly.

### Task 3: Direct manipulation

Files: frontend/src/geometry.ts, Canvas.tsx, Inspector.tsx, state and UI tests.
- [x] Pin projection controls and saved offset behavior with tests.
- [x] Drag/resize/rotate around fixed ground; update labels/default90°; keep source reset/undo.
- [x] Verify keyboard, owner transforms, preview bounds and all UI checks.

### Task 4: Integration and release

- [x] Run focused checks during iteration; frozen full pytest/Vitest/Playwright once, inspect visual sheet.
- [x] Record old mesh AA failure accurately; update docs/AGENTS for user override.
- [ ] Commit/push main, rebuild local8018, observe Linux CI and report exact results.
