# Backend Priority 1 TODO - Route Validation and Response Foundation

## Serial Phase 0

- [x] confirm the first implementation slice
  - `backend/src/routes/settings/media-settings.routes.ts`
  - `backend/src/routes/images/similarity-route-helpers.ts`
- [x] define a small shared helper API for route validation and contract-preserving 400 responses
- [x] keep helper names explicit and searchable
- [x] avoid changing route URLs or payload shapes
- [x] adopt the helper in one narrow settings slice first
- [x] run build/test verification for touched backend code

## Parallel Phase 1

### Subagent A - settings layer

- [x] replace repeated numeric range validation with shared helpers where safe
- [x] replace repeated enum validation with shared helpers where safe
- [x] reduce inline 400-response boilerplate without changing response shape
- [x] keep settings route behavior byte-for-byte compatible where possible

### Subagent B - image helper layer

- [x] move repeated integer/number fallback parsing to the shared helper layer where it fits
- [x] keep similarity route helper behavior unchanged
- [x] reduce local duplication without merging unrelated concerns
- [x] keep current image response shape unchanged

### Subagent C - compatibility review

- [x] inspect frontend API consumers for affected settings/image routes
- [x] confirm no renamed route paths
- [x] confirm no renamed response fields
- [x] flag any backend change that would require frontend edits

## Serial Phase 2

- [x] integrate accepted changes from settings and image tracks
- [x] remove duplicate helper variants created during fan-out
- [x] normalize helper naming and import locations
- [x] run backend verification again
- [x] record the next candidate slice if the pattern works
  - next slice selected: `backend/src/routes/graphWorkflows.ts`
  - first safe batch: folder routes + schedule routes 400-response cleanup

## Verification Checklist

- [x] backend build succeeds
- [ ] touched backend tests succeed, or equivalent verification succeeds
- [x] no route path changes
- [x] no response payload shape changes
- [x] no frontend code changes required for Priority 1 slice

## Stop Conditions

Stop and return to serial mode if any of the following happens:

- two tracks need to edit the same helper module at the same time
- route contract preservation becomes uncertain
- one helper abstraction starts absorbing unrelated business logic
- frontend compatibility can no longer be confirmed cheaply

## Phase 3 spot-check note

- checked `graphWorkflows.ts`, `generation-queue.routes.ts`, `auth.routes.ts`, `images/tagging.mutation.routes.ts`: keep route paths and legacy response envelopes unchanged
- next safe candidates after this batch:
  - `backend/src/routes/settings/rating.routes.ts`
  - `backend/src/routes/images/uploadMetadataUtilityRoutes.ts`
  - `backend/src/routes/image-editor.routes.ts`
