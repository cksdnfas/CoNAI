# Phase 05: Groups and Upload

## Objective

Migrate grouping and upload management flows used for organizing image sets.

## In Scope

- Image groups domain:
  - `frontend/src/pages/ImageGroups/*`
  - group create/edit/delete
  - auto-folder group conditions
  - group breadcrumb and hierarchy interactions
- Supporting reusable components:
  - `frontend/src/components/GroupTreeSelector/*`
  - `frontend/src/components/GroupAssignModal/*`
- Upload domain:
  - `frontend/src/pages/Upload/*`
  - `frontend/src/components/UploadZone/*`
- Dataset and grid interactions:
  - group image grid modal
  - lora dataset dialog

## Out of Scope

- Generation and workflow authoring (Phase 06).

## Work Breakdown

1. Port group data model and API hooks.
2. Port group list/card/modals and hierarchy selectors.
3. Port upload entry points and progress/error UX.
4. Validate auto-group conditions and result previews.

## Commit Checkpoints

- `feat(shadcn-phase-05): add groups list and group CRUD modals`
- `feat(shadcn-phase-05): migrate group hierarchy selectors and assignment flows`
- `feat(shadcn-phase-05): migrate upload page and dropzone pipeline`
- `test(shadcn-phase-05): add tests for group condition serialization`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Hook/util tests for group condition mapping and upload validation

Manual:

- Create/edit/delete group and verify persistence.
- Assign/unassign images to groups from gallery and detail contexts.
- Upload files and verify processing, thumbnails, and error handling.

## Exit Criteria

- Group and upload flows function with parity-level behavior.
- No blocking regressions in group hierarchy or upload lifecycle.

