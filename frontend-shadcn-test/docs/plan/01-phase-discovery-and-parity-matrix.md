# Phase 01: Discovery and Parity Matrix

## Objective

Build a complete migration contract so no legacy feature is lost.

## In Scope

- Inventory legacy routes from `frontend/src/App.tsx`.
- Inventory feature modules under:
  - `frontend/src/pages`
  - `frontend/src/components`
  - `frontend/src/services`
  - `frontend/src/hooks`
  - `frontend/src/i18n`
- Define parity matrix:
  - Legacy screen/component
  - Target location in `frontend-shadcn-test`
  - API dependencies
  - Priority and phase assignment
- Define route parity for:
  - `/login`
  - `/`
  - `/image-groups`
  - `/upload`
  - `/settings`
  - `/image/:compositeHash`
  - `/image-generation`
  - `/image-generation/new`
  - `/image-generation/:id/edit`
  - `/image-generation/:id/generate`

## Out of Scope

- Any UI rewrite beyond minimal documentation stubs.
- Backend API changes.

## Work Breakdown

1. Extract legacy feature map and dependencies.
2. Build migration checklist per route and domain.
3. Mark critical/non-critical behavior.
4. Record risk register (high-complexity areas: image editor, workflow graph, NAI tab, settings modules).

## Commit Checkpoints

- `docs(plan-01): add legacy route and feature inventory`
- `docs(plan-01): add parity matrix with API dependency map`
- `docs(plan-01): add migration risk register and acceptance checklist`

## Test Checkpoints

Automated:

- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend-shadcn-test && npm run lint`

Manual:

- Confirm every legacy route is represented in the matrix.
- Confirm each route has an owner phase and an acceptance criterion.

## Exit Criteria

- 100% of legacy routes mapped to target route/module.
- 100% of legacy API domains mapped to target API client modules.
- Signed checklist ready for implementation phases.

