# Refactor Wave Plan, 2026-07-09

## Status
- Owner: OpenClaw/Codex refactor wave
- Source branch: main
- Basis: current source scan plus graphify-out/GRAPH_REPORT.md from commit 155311bc
- Note: Graphify is stale against current HEAD, so use it as navigation only and confirm every task with source search.

## Objective
Reduce global maintenance risk from duplicate helpers, mixed responsibilities, oversized files, and weak dead-code detection while keeping runtime behavior unchanged.

## Scope
- Backend route middleware and response/error helper consolidation.
- Frontend import-cycle cleanup in image-generation and module-graph areas.
- Large service/component responsibility extraction.
- Shared API request policy cleanup.
- Dead export detection tooling evaluation.

## Non-goals
- No user-facing behavior change unless required to preserve existing behavior.
- No broad UI redesign.
- No schema or database behavior change in this wave.
- No generated Graphify output commits.

## Working Rules
- Commit in small units after focused verification.
- Keep each code commit bounded to one ownership area.
- Prefer existing helpers and local naming patterns.
- Do not merge semantically different types just because names match.
- After code edits, run `python -m graphify update .` before final reporting.

## Milestones

### M1. Backend async route middleware consolidation
Problem:
- `backend/src/middleware/asyncHandler.ts` and `backend/src/middleware/errorHandler.ts` both export `asyncHandler`.
- Route imports are split across both modules.

Plan:
- Keep `asyncHandler` owned by `asyncHandler.ts`.
- Remove the duplicate export from `errorHandler.ts`.
- Update route imports to the single source.

Verification:
- `npm run build:backend`
- `npm run verify:route-validation-foundation`

### M2. Image-generation barrel cycle cleanup
Problem:
- `image-generation-shared.tsx` re-exports `image-generation-drafts.ts`.
- `image-generation-drafts.ts` imports shared draft types/constants, creating a likely runtime cycle.

Plan:
- Stop re-exporting drafts from `image-generation-shared.tsx`.
- Import draft helpers directly from `image-generation-drafts.ts`.
- Keep shared UI/types in `image-generation-shared.tsx`.

Verification:
- `npm run build:frontend`
- `npm run verify:comfy-workflow-entry-contracts`
- `npm run verify:comfy-workflow-routing-contracts`

### M3. Module graph type/cycle boundary cleanup
Problem:
- Canvas/menu and workflow validation/shared areas have type ownership drift.
- Some cycles may be type-only, but boundaries are still unclear.

Plan:
- Move shared type-only contracts into existing type modules where possible.
- Avoid importing component modules from domain validation code.
- Keep UI component code out of workflow validation.

Verification:
- `npm run verify:module-graph-workflow-stability-contracts`
- `npm run verify:module-graph-execution-panel-contracts`
- `npm run verify:module-graph-bypass-contracts`

### M4. Generation queue service extraction
Problem:
- `backend/src/services/generationQueueService.ts` is a high-risk large service.

Plan:
- Extract only stable internal responsibilities first: status transition helpers, cancel/retry guards, payload pruning/recovery helpers.
- Keep public service API stable.

Verification:
- `npm run build:backend`
- `npm run verify:queue-hot-path-contracts`
- `npm run verify:queue-payload-pruning-contracts`

### M5. Module graph node card extraction
Problem:
- `module-graph-node-card.tsx` mixes card rendering, node-specific editors, query use, and port rendering.

Plan:
- Extract node-specific controls and port rows without changing behavior.
- Keep the top-level node card as composition root.

Verification:
- `npm run build:frontend`
- `npm run verify:module-library-grouping`
- `npm run verify:module-graph-execution-status-contracts`

### M6. Wildcard inline picker extraction
Problem:
- `wildcard-inline-picker-field.tsx` mixes caret tracking, popup positioning, autocomplete sources, detected token UI, and explorer pin state.

Plan:
- Extract popup positioning hook and insertion helpers first.
- Keep keyboard/input behavior unchanged.

Verification:
- `npm run build:frontend`
- `npm run verify:wildcard-search-selection-contracts`
- `npm run verify:prompt-inline-syntax-contracts`
- `npm run verify:wildcard-guest-access-contracts`

### M7. API request policy consolidation
Problem:
- Frontend JSON API calls use `fetchJson`, `requestJson`, direct `fetch`, and manual fallback errors inconsistently.

Plan:
- Define one envelope-aware JSON client path.
- Leave blob/download/upload flows as explicit exceptions.
- Migrate endpoint families incrementally.

Verification:
- `npm run build:frontend`
- `npm run verify:image-download-contracts`
- `npm run verify:image-similarity-policy-contracts`

### M8. Dead export detection
Problem:
- `noUnusedLocals` is disabled for the app build and no dead-export tool is installed.

Plan:
- Evaluate `knip` or `ts-prune` without committing broad removals.
- Remove exports only after source search confirms they are internal dead code.

Verification:
- Tool dry run evidence.
- Existing build and affected feature verifies.

## Completion Criteria
- Each milestone lands as one or more small commits.
- Build and targeted verifies pass for changed areas.
- No unrelated formatting or generated-output churn is committed.
- Refactor docs remain current with completed commit IDs.
