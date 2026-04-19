# Backend Priority 1 Plan - Route Validation and Response Foundation

## Goal

Reduce backend duplication in validation and error handling first, then use that shared foundation to clean up settings routes and image route helpers without breaking frontend integrations.

## Why This Is Priority 1

This is the best first move because it creates shared primitives that later refactors can reuse. It also has a lower frontend regression risk than immediately merging or relocating route ownership.

## Scope

### In scope

- shared route validation helpers
- shared 400-response helper behavior
- targeted adoption in selected settings routes
- targeted adoption in selected image-route helper flows
- contract-preserving cleanup only

### Out of scope for this phase

- route URL changes
- large route file splits or merges
- response payload redesign
- frontend component rewrites
- service-layer redesign outside direct support for the route foundation

## Execution Model

The work should start with a short serial phase, then fan out into parallel subagent-friendly tracks.

## Phase 0 - Serial prerequisites

This phase should stay serial because later tracks depend on shared decisions.

1. Freeze the API contract boundaries for the first refactor slice
   - settings route request fields and response shapes must remain unchanged
   - image route request fields and response shapes must remain unchanged
2. Introduce shared validation/response helpers in one neutral backend route utility module
3. Verify the helper API is small, explicit, and reusable
4. Apply the helper to one narrow slice first to validate the approach

Exit criteria:

- shared helper module exists
- at least one backend route slice uses it without contract changes
- build/test baseline still passes

## Phase 1 - Parallel work after the shared foundation exists

Once Phase 0 is complete, work can split into parallel tracks.

### Track A - Settings route adoption

Suggested owner: subagent A

Targets:

- `backend/src/routes/settings.ts`
- `backend/src/routes/settings/media-settings.routes.ts`
- `backend/src/routes/settings/appearance.routes.ts`

Tasks:

- replace repeated enum/range/boolean validation patterns with shared helpers where safe
- preserve all response shapes and route behavior
- avoid broad file reorganization in this track

Deliverable:

- reduced repeated validation code in the settings layer

### Track B - Image route helper adoption

Suggested owner: subagent B

Targets:

- `backend/src/routes/images/similarity-route-helpers.ts`
- `backend/src/routes/images/similarity.routes.ts`
- selected shared helper files under `backend/src/routes/images/`

Tasks:

- move repeated fallback parsing and route-guard utility logic onto the shared helper foundation where it clearly fits
- preserve current image API payload shapes
- avoid changing output field names or sort behavior

Deliverable:

- reduced parsing/validation duplication in image route helpers

### Track C - Verification and frontend contract guard

Suggested owner: subagent C

Targets:

- backend route consumers in `frontend/src/lib/api*`
- any direct settings/image route consumers discovered during implementation

Tasks:

- confirm that no route path or expected payload shape changed
- compare affected backend routes against current frontend call patterns
- flag any contract risk before merge

Deliverable:

- lightweight compatibility report for changed backend slices

## Phase 2 - Serial integration

This phase should be serial again.

1. merge the results of Tracks A and B
2. resolve overlapping helper names and module boundaries
3. run verification for changed slices
4. normalize comments, naming, and import paths only where needed

Exit criteria:

- one coherent helper foundation remains
- no duplicate helper variants survive in the touched slice
- no frontend contract drift is introduced

## Phase 3 - Optional second fan-out

If Phase 2 is stable, the next parallel wave can target:

- `graphWorkflows.ts`
- `generation-queue.routes.ts`
- `auth.routes.ts`
- `images/tagging.mutation.routes.ts`

These should only begin after the Priority 1 foundation proves useful in real route files.

## Suggested Subagent Split

### Subagent A

- settings route validation adoption
- focused on enum/range/boolean cleanup

### Subagent B

- image route helper adoption
- focused on query parsing and route guard cleanup

### Subagent C

- compatibility review
- frontend surface check and regression watch list

### Main owner session

- defines shared helper API
- resolves naming and integration conflicts
- keeps the final shape coherent

## Success Criteria

- repeated validation patterns are reduced in the touched slice
- repeated 400-response patterns are reduced in the touched slice
- no API path changes
- no response contract changes
- backend build/test checks pass for touched code
- frontend callers do not need code changes for the first slice

## Recommended First Implementation Slice

Start with:

1. shared route validation helper module
2. `backend/src/routes/settings/media-settings.routes.ts`
3. `backend/src/routes/images/similarity-route-helpers.ts`

This slice is small enough to validate the strategy, but meaningful enough to prove reuse across two different backend areas.
