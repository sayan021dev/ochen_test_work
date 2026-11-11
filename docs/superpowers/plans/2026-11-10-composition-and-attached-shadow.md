# Composition fidelity and attached shadows

> Архив этапа разработки. Текущее принятое поведение описано в [итоге V1](../../V1.md);
> при выпуске использовать [актуальную инструкцию](../../DEPLOYMENT.md).

The user explicitly requested implementation and tests, with main commits/push.
This is a correction of the accepted product rather than a new approval stage.

## Verified causes and intended behavior

- Fixed normalized slots ignore natural-language relations and combined object sizes.
  Parse explicit spatial instructions into validated family relations, then use
  deterministic constrained packing in all three variants. Conservative source
  bounds prevent unintended overlaps; explicit on/behind relations allow deliberate overlap.
- Each SVG instance currently paints its shadow together with its body. A later
  instance's shadow can therefore cover an earlier body. Render shadows in a
  shared lower pass and bodies in their existing layer order, in preview and export.
- Custom shadows are currently independent affine footprints. Keep the original
  contact perimeter fixed and fill the sweep from that perimeter to the transformed
  footprint with vector bridges measured from source contact edges. Original files
  remain unchanged; this opt-in feature remains an artistic 2D deformation.
- At high browser zoom, the responsive panel has less vertical space; retained
  scroll and disappearing close controls obscure its state. Give it stable chrome,
  reset explicit opening to the top and keep content independently scrollable.
- Replace oversized alternative cards with readable previews and numbers. Selecting
  a variant collapses the tray; a bottom toggle reopens the same alternatives.

## Work and acceptance

- [x] Add red regressions for directional/group requests, bounds, no accidental collisions.
- [x] Validate AI layout intent and integrate cache/compose without tightening topic guard.
- [x] Implement contact bridges and a shared shadow pass with preview/export parity.
- [x] Verify mouse shadow controls keep the attachment fixed and one undo per gesture.
- [x] Fix responsive panel, alternatives tray and shadow help spacing with browser tests.
- [x] Run a broad deterministic prompt × variant × format × detail corpus, visual sheets,
  and a limited real AI spatial-request corpus through the existing proxy.
- [x] Run final required suites, independent review, local Docker smoke, main push and CI.

Parallel ownership: layout agent owns composition/AI/layout tests; UI agent owns
App/Inspector/styles and its browser tests; shadow agent owns shadow renderers,
metadata preparation and original-shadow tests. Root owns integration, Canvas,
SVG preview/export, type contracts, parity and final acceptance.

Review issues resolved: shared-support collisions, cross-clause/pronoun subjects, color adjective false noun, per-axis semantic merge, dynamic bridge mask bounds, original source preservation. Final local/remote/CI status is reported with the release.
