# Phase 02: Foundation and Architecture

## Objective

Create the shared app foundation required to migrate all feature domains safely.

## In Scope

- App shell and route skeleton expansion in:
  - `frontend-shadcn-test/src/app/routes.tsx`
  - `frontend-shadcn-test/src/components/layout/*`
- Shared providers:
  - React Query defaults
  - Auth/session provider equivalent
  - Theme persistence and toggling
  - i18n bootstrap
- API layer hardening:
  - endpoint modules by domain
  - error normalization
  - request/response typing
- Design-system baseline for frequently used UI patterns:
  - modal/dialog wrappers
  - table and form primitives
  - feedback states (loading/empty/error)
- Test tooling bootstrap (if missing):
  - unit/integration test runner
  - API mocking strategy

## Out of Scope

- Full domain feature migration (handled in later phases).

## Work Breakdown

1. Add placeholder routes for all legacy targets.
2. Implement cross-cutting providers and config.
3. Implement API module conventions and query key conventions.
4. Establish shared patterns for page layout and async state handling.

## Commit Checkpoints

- `feat(shadcn-phase-02): add route skeletons for legacy parity`
- `feat(shadcn-phase-02): add auth/theme/i18n providers`
- `refactor(shadcn-phase-02): standardize api client and query keys`
- `test(shadcn-phase-02): bootstrap unit test environment`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Test runner command if introduced (for example `npm run test`)

Manual:

- Verify all target routes render without crash.
- Verify theme and language state persists after refresh.
- Verify API client handles 4xx/5xx and timeout consistently.

## Exit Criteria

- Shared architecture accepted and used by all later phases.
- Route scaffold complete for every parity route.
- Foundation tests green in CI/local.

