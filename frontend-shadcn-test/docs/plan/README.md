# Frontend Migration Plan Index

This folder contains a phased migration plan to rebuild the legacy `frontend` (MUI) into `frontend-shadcn-test` (shadcn/ui + Tailwind) while preserving feature parity.

## Planning Principles

- Do not break existing backend contracts.
- Preserve behavior first, improve visuals second.
- Ship in small vertical slices with test evidence.
- Keep old frontend runnable until final cutover.

## Phase Files

1. `01-phase-discovery-and-parity-matrix.md`
2. `02-phase-foundation-and-architecture.md`
3. `03-phase-gallery-search-bulk.md`
4. `04-phase-image-detail-and-editor.md`
5. `05-phase-groups-and-upload.md`
6. `06-phase-generation-and-workflows.md`
7. `07-phase-settings-integrations-i18n.md`
8. `08-phase-qa-hardening-cutover.md`

## Global Commit Policy

- Branch naming: `feat/shadcn-phase-XX-*`
- Commit size target: 300-700 changed lines for reviewability
- Commit style examples:
  - `feat(shadcn-phase-02): add app providers and route skeletons`
  - `refactor(shadcn-phase-03): migrate image list query state to react-query`
  - `test(shadcn-phase-08): add regression smoke for critical routes`

## Global Validation Baseline

Run from repo root unless noted:

```bash
npm run dev:backend
npm run dev:frontend:shadcn
cd frontend-shadcn-test && npm run lint
cd frontend-shadcn-test && npm run build
```

Manual baseline checks:

- Route load without console errors
- API proxy works for `/health`, `/api/*`, `/uploads/*`, `/temp/*`
- Hash route refresh and deep-link behavior are correct

