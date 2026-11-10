# Receiver Shadows and Scene Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Paint supported objects' shadows on their receivers and add a removable experimental light source.
**Architecture:** Persist an instance support graph; render receiver-clipped casts before each supported body. Resolve optional global lighting in identical Python/TS helpers. Feature flag disables every custom interaction/render effect while preserving core receiver casts.
**Tech Stack:** FastAPI, React/TypeScript, native SVG masks/use, pytest/Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-receiver-shadows-and-light-design.md

## Global Constraints

Keep original SVG bytes, source geometry and ordinary behavior unchanged for scenes without supports/light. Preserve JSON v1 compatibility. No paid calls. Commit/push main finished steps.

## Review Focus

Support chains and multiple targets; hidden/deleted/cyclic receiver references; actual receiver holes under transforms; flag-off reload/export; canceled light drag and stale document gestures.

### Task 1: Contracts, parser and graph

Files: backend/app/models.py, composition.py, layout.py; frontend/types.ts, support.ts, state.ts.
- [x] Add red tests for exact user chain, multiple receivers and invalid graph.
- [x] Persist support_ids, stable graph order and lifecycle through store/save/load.
- [x] Add nullable light schema and validate finite bounds; retain old JSON compatibility.

### Task 2: Core rendering and experimental lighting

Files: backend/app/svg.py, layers.py, lighting.py; frontend/Illustration.tsx, lighting.ts, geometry.ts.
- [x] Pin receiver alpha clipping and no unrelated occlusion in native renderer tests.
- [x] Share effective-shadow resolution; original casts when experiment off, global projection when on.
- [x] Extract Illustration component so UI gestures and rendering can be changed independently.
- [x] Verify transformed receiver masks, chains, holes and Python/TS parity.

### Task 3: Interface and disable flag

Files: config.py, main.py, .env.example; frontend/features.tsx, App.tsx, Canvas.tsx, Inspector.tsx, state.ts.
- [x] Test flag-off core shadows and hidden custom controls/export behavior.
- [x] Add scene-light toggle, draggable marker, height and opacity controls; one-step history.
- [x] Add manual receiver selector; keep existing interactions working.

### Task 4: Review, acceptance and release

- [x] Inspect user's chain and varied layouts; frozen full tests once after focused checks.
- [x] Update docs/evidence, rebuild local8018, commit/push main and observe CI.

Functional commit9e8f57b, LinuxCI run42891741350 success. Local1370pytest/134Vitest/49Playwright, branchcoverage96%; Docker8018 smoke save/reload and global-off contact preservation passed.
