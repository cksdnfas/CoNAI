# Phase 03: Gallery, Search, and Bulk Operations

## Objective

Migrate core browsing experience from legacy Home page with behavior parity.

## In Scope

- Migrate legacy Home domain behavior from:
  - `frontend/src/pages/Home/*`
  - `frontend/src/components/ImageList/*`
  - `frontend/src/components/ImageCard/*`
  - `frontend/src/components/SearchBar/*`
  - `frontend/src/components/FilterBuilder/*`
  - `frontend/src/components/SelectionToolbar/*`
  - `frontend/src/components/BulkActionBar/*`
  - `frontend/src/components/RatingBadge/*`
- Support both pagination/infinite behavior used by legacy hooks:
  - `useImages`
  - `useInfiniteImages`
  - `usePaginatedImages`
- Preserve selection and bulk action flows:
  - select all/current page
  - move group, delete, rating updates

## Out of Scope

- Image detail page and editor (Phase 04).
- Group management page (Phase 05).

## Work Breakdown

1. Build image list container and state model.
2. Add search and advanced filter UI with query serialization parity.
3. Add card actions, selection toolbar, and bulk action pipeline.
4. Add prompt preview/rating badges and verify event behavior.

## Commit Checkpoints

- `feat(shadcn-phase-03): add gallery list and query pagination`
- `feat(shadcn-phase-03): migrate search and filter builder`
- `feat(shadcn-phase-03): add selection toolbar and bulk actions`
- `test(shadcn-phase-03): add hook tests for gallery query states`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Domain tests for query/filter/selection logic

Manual:

- Search keyword, model, and hash behave like legacy frontend.
- Bulk operations update UI and backend state consistently.
- Empty/loading/error states match expected UX.

## Exit Criteria

- Legacy Home page functionality is reproducible in shadcn frontend.
- No critical parity gaps in gallery/search/bulk scenarios.

