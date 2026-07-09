# Refactor Wave Plan, 2026-07-09

## Status
- Owner: OpenClaw/Codex refactor wave
- Source branch: main
- Basis: current source scan plus graphify-out/GRAPH_REPORT.md refreshed after commit 35dbf4b1
- Note: Graphify has been refreshed after the latest code commit in this wave; still confirm each refactor target with source search before editing.
- Over-splitting audit: three read-only parallel audits found no refactor commits that should be reverted. Follow-up work should prefer guardrails and direct contracts over more extraction.

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

Completed commits:
- `8692f4ee` refactor: unify async route handler

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

Completed commits:
- `42ddac1b` refactor: split image generation drafts imports

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

Completed commits:
- `125fc53b` refactor: move graph validation contracts

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

Completed commits:
- `b4e60a6c` refactor: extract queue terminal waiters
- `337f4b6d` refactor: extract queue service throttle
- `d852eafd` refactor: extract queue transition updates
- `f51b307e` refactor: extract queue cancellation helper
- `35dbf4b1` refactor: harden queue helper boundaries

Audit result:
- Keep the current helper set. `generationQueueService.ts` remains the orchestration root.
- `queueTerminalWaiters`, throttle, transitions, and upstream cancellation are useful boundaries for future queue/provider changes.
- Do not split `queueJobExecutors.ts` further until provider-specific feature work creates a concrete interface need.

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

Completed commits:
- `544e6981` refactor: extract default graph port rows
- `7fbbadf4` refactor: extract graph node model options

Audit result:
- Keep the node-card extracts. They isolate layout/port/model-option concerns without hiding behavior.

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

Completed commits:
- `59d7b6c2` refactor: extract wildcard detected chips
- `9886ad0c` refactor: extract wildcard popup positioning
- `f230de75` refactor: extract wildcard detected characters

Audit result:
- Keep the wildcard extracts. Rendering, geometry, and detected-character lookup now have clearer ownership.

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

Completed commits:
- `0eeaf02a` refactor: share api envelope unwrapping
- `b0048353` refactor: use api data helper for graph roots
- `50039712` refactor: use api data helper for workflows
- `0f38fc88` refactor: share danbooru api data reader
- `f145b025` refactor: share prompt and search api readers
- `d143bae6` refactor: share folder api data reader
- `7d41c818` refactor: share backup source api reader
- `eeed2056` refactor: share custom node api reader

Audit result:
- Keep `requestApiData<T>` and the file-local API readers.
- Stop broad API-client consolidation for this wave; more generic abstraction would hide endpoint-specific fallback behavior.

### M8. Dead export detection
Problem:
- `noUnusedLocals` is disabled for the app build and no dead-export tool is installed.

Plan:
- Evaluate `knip` or `ts-prune` without committing broad removals.
- Remove exports only after source search confirms they are internal dead code.

Verification:
- Tool dry run evidence.
- Existing build and affected feature verifies.

Completed commits:
- `aad5803a` refactor: trim verified dead exports
- `35dbf4b1` refactor: harden queue helper boundaries

Audit result:
- `aad5803a` was not too aggressive. It only removed exports from symbols that remained local to the same file.
- `35dbf4b1` removed/de-exported another small confirmed-internal batch.
- Keep route-module default exports, barrel exports, public API types, shared type mirrors, UI variant helpers, and i18n resource key types out of automated cleanup unless a separate source search proves they are private.

## Current Stop Line
- Good enough for near-term feature work: yes.
- More extraction needed now: no.
- Next worthwhile work is feature-driven extraction, not size-driven extraction.
- If continuing later, prefer provider-specific queue executor boundaries only when a new provider feature needs them.

## Completion Criteria
- Each milestone lands as one or more small commits.
- Build and targeted verifies pass for changed areas.
- No unrelated formatting or generated-output churn is committed.
- Refactor docs remain current with completed commit IDs.
