# Auth Maintainability Refactor Plan, 2026-04-13

## Goal
Improve maintainability in the recent auth and account-management work without over-fragmenting the codebase.

This wave is intentionally conservative. The goal is not maximum separation. The goal is to make the auth-related code easier to scan, reason about, and safely extend later.

## Working Rules
- Keep runtime behavior unchanged unless a tiny fix is required to complete the refactor safely.
- Prefer a few obvious modules over many tiny files.
- Extract only responsibility boundaries that are already visible in the current code.
- Keep screen-level and route-level entry files as orchestration layers.
- Reuse existing naming patterns and query keys.
- Avoid creating a new abstraction framework for auth.
- Verify each refactor with the smallest relevant build step first, then with the combined build.

## Success Criteria
1. No target file mixes too many unrelated auth responsibilities.
2. Screen-level files read as coordinators instead of implementation dumps.
3. Route files read as endpoint registration plus thin request handling.
4. Database setup code is easier to scan by separating schema, seed, and legacy-sync concerns where helpful.
5. Frontend and backend builds still pass.

## Refactor Targets

### A. `frontend/src/features/settings/components/security-tab.tsx`
Problem:
- The component mixes auth status display, first-admin setup, admin credential updates, account review, page-access editing, recovery info, and mutation/query wiring.

Refactor direction:
- Keep `SecurityTab` as the screen-level entry.
- Extract the query/mutation orchestration into one focused hook.
- Extract the visible card sections into a small set of nearby components.
- Keep shared query keys local to the feature unless there is a clear reuse need.

Expected result:
- `SecurityTab` becomes readable top-down.
- Auth account and page-access UI become easier to maintain without hunting through one large file.

### B. `backend/src/routes/auth.routes.ts`
Problem:
- The route file handles session payload shaping, login/logout/setup, guest signup, account review, page-access editing, and admin group changes in one place.

Refactor direction:
- Keep `auth.routes.ts` as the router entry.
- Extract payload/session helper logic into a nearby helper module.
- Extract route handlers into small named handler functions when it reduces scrolling and branching.
- Do not introduce a large service layer unless the current boundary is already clear.

Expected result:
- The router file reads as an endpoint map.
- Auth response/session logic becomes easier to reuse and verify.

### C. `backend/src/database/authDb.ts`
Problem:
- One file currently owns schema creation, default group/catalog seeding, admin permission grants, anonymous normalization, legacy sync, migration from older DBs, and lifecycle helpers.

Refactor direction:
- Keep the auth DB bootstrap entry in `authDb.ts`.
- Extract schema creation SQL setup into one nearby helper module.
- Extract seed and normalization logic into one nearby helper module if it keeps the entry file shorter and clearer.
- Keep legacy migration and legacy-admin sync readable and explicit.
- Avoid scattering SQL across too many small helpers.

Expected result:
- `authDb.ts` becomes a bootstrap/orchestration file.
- Schema and default-access setup become easier to inspect independently.

### D. `frontend/src/features/settings/settings-page.tsx`
Problem:
- The file is far above the desired size and still mixes page composition, settings access gating, draft state, mutation wiring, validation, and tab orchestration.

Refactor direction:
- Do not attempt a large rewrite in this wave.
- Keep `SettingsPage` as the composition root.
- Only extract tiny auth-related or clearly stable helpers if they improve readability immediately.
- Leave broader settings-page breakup for a later refactor wave after the auth-specific cleanup lands.

Expected result:
- The page stays stable.
- This wave reduces auth-related complexity first without turning into a full settings rewrite.

## Proposed File Shape

### Frontend
- `frontend/src/features/settings/components/security-tab.tsx`
- `frontend/src/features/settings/components/security-tab-data.ts`
- `frontend/src/features/settings/components/security-status-card.tsx`
- `frontend/src/features/settings/components/security-account-form-card.tsx`
- `frontend/src/features/settings/components/security-account-list-card.tsx`
- `frontend/src/features/settings/components/security-page-access-card.tsx`
- `frontend/src/features/settings/components/security-recovery-card.tsx`

Note:
- If the implementation feels cleaner with fewer files, merge adjacent card components instead of forcing all of these.

### Backend
- `backend/src/routes/auth.routes.ts`
- `backend/src/routes/auth-route-helpers.ts`
- `backend/src/database/authDb.ts`
- `backend/src/database/authDbSchema.ts`
- `backend/src/database/authDbSeed.ts`

Note:
- If legacy sync and migration stay clearer inside `authDb.ts`, keep them there.
- The point is readability, not maximum extraction.

## Execution Order
1. Write plan and TODO docs.
2. Refactor frontend security-tab structure.
3. Refactor backend auth route helpers.
4. Refactor backend auth DB bootstrap structure.
5. Apply only minimal settings-page follow-up cleanup if it naturally falls out of the auth changes.
6. Run frontend build, backend build, then combined build.

## Verification Plan
- Frontend refactor:
  - `npm run build:frontend`
- Backend refactor:
  - `npm run build:backend`
- Final verification:
  - `npm run build:frontend && npm run build:backend`

## Non-Goals
- No auth model redesign.
- No permission catalog redesign.
- No API contract changes unless needed for a safe internal cleanup.
- No broad settings-page rewrite in this wave.
- No speculative shared UI framework for cards/forms.
