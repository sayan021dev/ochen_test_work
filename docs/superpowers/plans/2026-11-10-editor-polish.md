# Editor refinement implementation plan

User authorized all listed changes in chat and screenshots, including optional free transforms, corrected original-shadow controls and deploy password gate. Direct main commits/push remain authorized.

## Outcomes and boundaries
- Fixed viewport editor, independent side-panel scroll, larger centered canvas, no fake/nonfunctional labels.
- Popular size selector recenters visible composition, scales down uniformly if needed; working zoom/fullscreen.
- Projects page with real vector previews; export dropdown; delayed one-time cookie welcome; interactive palette modal.
- Floating selection actions, proportional corner and independent side resize, rotation around center, Ctrl/Cmd C/V inside editor. New per-object scales are an explicit user-requested override of earlier no-independent-resize policy; default geometry remains unchanged.
- Replace body-projection shadow with the original cast-shadow footprint, opt-in only, no double cast. Default original SVG unchanged.
- Optional environment password gate on page and API; fail closed when deployment requires password. No production deployment in this change.
- Backend scope validation blocks task diversion before paid calls; semantic AI acceptance plus enum IDs, no prompt-only security claims.

## Steps
- [x] Regression tests for formats, centering, transforms, copy/paste and original-shadow isolation.
- [x] Add optional schema fields, geometry/selection gestures and renderer parity.
- [x] Simplify editor shell and integrate gallery/palette/welcome/export/fullscreen.
- [x] Integrate separately implemented auth and prompt-scope guard, update docs/config examples.
- [x] Run full Python/frontend/browser checks; visually inspect common viewport sizes and shadows.
- [x] Fresh whole-change review, fix important findings with regressions, push main, verify CI/remote and local runtime.

Parallel boundaries: password_gate owns auth.py/config.py/test_auth.py; prompt_scope owns prompts.py/ai.py/tests; editor_panels owns four new panel components/css/tests. Root owns main integration, scene/geometry, App/Inspector/Canvas and corrected shadows. No private SlideCode source copied.

Latest additions: library search removed, consistent gallery brand, larger welcome greeting, centered zoom with two-axis native scrollbars, separate shadow frame, hold-to-repeat numeric angle, header new-project action, two save states and explicit editable title. Review caught format/scale limits, corner-ratio clamp, auth/fullscreen expiry and owner-session recovery; regression coverage added. Final remote/CI verification is recorded in acceptance after push.
