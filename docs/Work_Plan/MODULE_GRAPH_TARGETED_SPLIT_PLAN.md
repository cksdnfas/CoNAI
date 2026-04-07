# Module Graph Targeted Split Plan

## Goal

Reduce local file responsibility for the two highest-priority files from the recent workflow-output-management work, without turning the change into a broad refactor.

This plan intentionally limits scope to:
1. `backend/src/routes/graphWorkflows.ts`
2. `frontend/src/features/module-graph/components/module-workflow-output-management-panel.tsx`

## Why now

Both files are still below the hard 700-line threshold, but they already carry too many responsibilities for safe incremental growth.

Current risk:
- new output-management work will keep expanding these files
- future bug fixes will require touching unrelated logic in the same file
- review cost is higher than it should be for targeted changes

## Refactor constraints

- Keep the current behavior unchanged.
- Do not redesign route architecture.
- Do not introduce speculative abstractions.
- Prefer extracting cohesive chunks that already behave like separate responsibilities.
- Reuse existing UI primitives and action-bar patterns.
- Keep comments and new helper names in English.

## Scope

### Priority 1 — `graphWorkflows.ts`

### Problem

The route file currently mixes:
- workflow CRUD
- folder CRUD
- execution read/execute/cancel routes
- browse-content aggregation
- output-management file copy logic
- empty-run cleanup logic
- execution decoration / workflow parsing helpers

### Target split

Move only the output-management and browse-content domain logic out of the route file.

### Planned extraction

Create focused backend services:
- `graphWorkflowViewService`
  - parse stored workflow records
  - decorate execution records with runtime queue state
  - build folder/root browse content
- `graphWorkflowOutputManagementService`
  - clean up empty executions
  - copy generated workflow artifacts to watched folders

### Keep in route file

- route definitions
- request validation
- response status handling
- CRUD endpoints that are still small enough

### Success criteria

- `graphWorkflows.ts` becomes mainly a route-definition file
- browse-content and output-management internals are no longer implemented inline in the route file
- backend build passes

## Scope

### Priority 2 — `module-workflow-output-management-panel.tsx`

### Problem

The component currently mixes:
- browse-content-to-view-model shaping
- output tab rendering
- queue tab rendering
- copy panel rendering
- selection state
- download/copy/cancel/delete action handling
- action bar rendering

### Target split

Keep one orchestration container, but move the two tab render blocks into their own components.

### Planned extraction

Create focused UI components:
- `module-workflow-generated-outputs-tab.tsx`
- `module-workflow-empty-runs-tab.tsx`

### Keep in panel file

- shared local state
- derived selections
- action handlers
- top summary card
- segmented tab switch
- shared action bars

### Success criteria

- the panel file becomes a coordinator instead of a full rendering monolith
- output-tab markup and queue-tab markup are no longer embedded inline in the same file
- frontend build passes

## Non-goals

- No route-per-file reorganization
- No API client breakup in this pass
- No page-level module-graph refactor in this pass
- No new UX features or behavior changes in this pass
- No renaming sweep across the module-graph feature

## Verification

After both priority items are done:
- run backend build
- run frontend build
- confirm no behavior changes were introduced by the split

## Notes for implementation

- Prefer one clean commit for this targeted split work.
- If one of the two files resists clean extraction, stop at the smallest useful split instead of forcing architecture.
