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
- [x] touched backend tests succeed, or equivalent verification succeeds
  - 2026-05-14: added and ran `npm run verify:route-validation-foundation` for route-validation helper payloads, parser fallbacks, and legacy route integer parsing semantics.
  - 2026-05-14: added and ran `npm run verify:upload-metadata-utilities` for upload metadata helper contracts covering multipart quality/save-option parsing, output format resolution, metadata patch validation, extracted preview shaping, and download headers.
  - 2026-05-14: added and ran `npm run verify:graph-workflow-route-contracts` for graph workflow route helper contracts covering legacy ID parsing, 400/404 response payloads, schedule parser values, max-run parsing, and enqueue count bounds.
  - 2026-05-14: added and ran `npm run verify:file-verification-route-contracts` for file verification route helper contracts covering legacy log-limit parsing and settings restart decisions without invoking real verification/deletion.
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
- added focused graph workflow route contract verification before further folder/schedule cleanup so helper reuse can stay behavior-preserving
- next safe candidates after this batch:
  - `backend/src/routes/settings/rating.routes.ts` — covered by `npm run verify:route-validation-foundation`
  - `backend/src/routes/images/uploadMetadataUtilityRoutes.ts` — helper contracts covered by `npm run verify:upload-metadata-utilities`
  - `backend/src/routes/image-editor.routes.ts` — covered by `npm run verify:route-validation-foundation`
  - `backend/src/routes/fileVerification.ts` — covered by `npm run verify:file-verification-route-contracts`
