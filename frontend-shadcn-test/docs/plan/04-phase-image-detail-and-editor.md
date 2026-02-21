# Phase 04: Image Detail and Editor

## Objective

Migrate deep image inspection and editing flows with metadata fidelity.

## In Scope

- Image detail route migration:
  - `/image/:compositeHash`
  - Legacy sources: `frontend/src/pages/ImageDetail/*`, `frontend/src/components/ImageViewerModal/*`
- Metadata and prompt rendering parity:
  - positive/negative/auto tags
  - generation metadata sections
  - copy-to-clipboard actions
- Image editor migration:
  - `frontend/src/components/ImageEditorModal/*`
  - crop, draw, layers, history, zoom/pan, export
- Modal-level supporting features:
  - canvas gallery modal
  - prompt display card/panel integration

## Out of Scope

- Group and upload workflows (Phase 05).
- Generation/workflow builder (Phase 06).

## Work Breakdown

1. Implement image detail shell and metadata side panels.
2. Port viewer controls and group navigation behavior.
3. Port image editor hooks and canvas utilities.
4. Align keyboard shortcuts and file export/import behavior.

## Commit Checkpoints

- `feat(shadcn-phase-04): migrate image detail route and metadata panels`
- `feat(shadcn-phase-04): migrate viewer modal controls and navigation`
- `feat(shadcn-phase-04): migrate image editor core hooks and canvas`
- `test(shadcn-phase-04): add unit tests for image transform and export utils`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Utility tests for transform/canvas export/history reducer

Manual:

- Open image detail from gallery and direct hash URL.
- Validate metadata fields against legacy frontend output.
- Validate edit actions (crop/draw/layer/history/export) on sample images.

## Exit Criteria

- Detail page and editor flows are production-usable in shadcn frontend.
- No data-loss or metadata mismatch in edited image outputs.

