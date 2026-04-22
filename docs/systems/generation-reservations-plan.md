# Generation Reservations Plan, 2026-04-22

## Goal
Separate workflow-level reservations from worker-level job queues in the CoNAI generation workspace so users can understand and manage two different queue layers without mixing them.

## User Decision Snapshot
- add a new top-level generation tab alongside `NAI / ComfyUI / Wildcard / Workflow`
- the new tab should represent workflow-level reservations, not worker jobs
- rename the previous workflow-side `대기열` wording to `예약작업`
- keep `작업 큐` as the worker/job queue for concrete NAI and ComfyUI jobs
- the small header popup that currently shows `작업 큐` must also switch between `작업 큐` and `예약작업` through tabs in the title area

## Domain Model

### Worker/job queue
This is the lower-level execution queue.
Examples:
- NAI generation jobs
- ComfyUI queue jobs
- server/tag/job dispatch state

Primary user-facing name:
- `작업 큐`

### Workflow reservation layer
This is the higher-level workflow automation layer.
Examples:
- saved workflow autorun schedules
- reserved/scheduled workflow executions
- empty or output-less scheduled runs that still need review/cleanup

Primary user-facing name:
- `예약작업`

## Current State
- `frontend/src/features/image-generation/image-generation-page.tsx` exposes `NAI / ComfyUI / Wildcard / Workflow` as the main generation tabs.
- Workflow-side reservation management currently lives inside module-graph browse management rather than as its own generation surface.
- `frontend/src/features/module-graph/components/module-workflow-output-management-panel.tsx` currently includes a browse tab for `대기열 · 빈 실행`.
- `frontend/src/features/module-graph/components/module-workflow-empty-runs-tab.tsx` bundles two workflow-level concerns together:
  - saved autorun schedules
  - output-less reserved executions
- `frontend/src/features/image-generation/components/generation-queue-header-widget.tsx` already renders a small popup for worker/job queues only.

## Target UX

### 1. Main generation tabs
New target layout:
- `NAI`
- `ComfyUI`
- `Wildcard`
- `Workflow`
- `예약작업`

Behavior:
- `Workflow` focuses on workflow authoring, browsing, and execution detail views
- `예약작업` becomes the dedicated workflow-automation surface for saved schedules and reserved workflow executions

### 2. Header mini popup
The current popup title row should become a tab switcher.

Popup tabs:
- `작업 큐`
- `예약작업`

Behavior:
- `작업 큐` tab keeps the current worker/job queue view
- `예약작업` tab shows workflow-level schedule/reservation visibility from the same popup entry point

## Scope

### In scope
- add a new top-level generation tab for workflow reservations
- remove workflow reservation management from the current workflow-page body tab stack
- rename workflow-level `대기열` wording to `예약작업`
- add popup tab switching between worker jobs and workflow reservations
- reuse existing frontend APIs where possible
- frontend build verification

### Out of scope for this slice
- backend schema changes unless a blocker appears
- redesigning worker queue data contracts
- changing the execution engine behavior itself
- deep workflow-folder-specific reservation filtering in the first pass

## Recommended Implementation Shape

### Track A, top-level reservations page
Create one dedicated reservations panel under image generation.

Suggested data source:
- `getGraphWorkflowBrowseContent()` at root scope

Suggested reuse:
- `ModuleWorkflowEmptyRunsTab`
- existing module-graph schedule mutation APIs
- existing empty-execution cleanup / cancel APIs

Expected result:
- workflow schedules and reserved executions can be managed without entering the Workflow page body

### Track B, workflow page cleanup
Remove the workflow-side browse tab that currently mixes reservation management into the workflow output-management surface.

Expected result:
- workflow browse mode focuses on outputs/artifacts instead of carrying automation management inside it

### Track C, header popup split
Extend the queue popup so the header area becomes a tab switcher.

Suggested data sources:
- worker jobs: existing generation queue queries
- reservations: existing graph workflow schedule/browse-content queries

Expected result:
- users can inspect both queue layers from the same header affordance without conflating them

## Naming Rules
- use `작업 큐` only for worker/job queue surfaces
- use `예약작업` for workflow-level schedule/reservation surfaces
- avoid using `대기열` as the primary label for workflow-level automation surfaces in this flow
- keep technical queue-position labels where they describe literal worker queue order

## Execution Order
1. Write this plan doc.
2. Add the new top-level `예약작업` generation tab.
3. Build the dedicated reservations panel by reusing existing workflow schedule and empty-run management.
4. Remove the old workflow-page reservation tab from module-graph browse management.
5. Convert the header popup title row into `작업 큐 / 예약작업` tabs.
6. Run frontend build.
7. Refresh Graphify.

## Verification Plan
- `npm run build` in `frontend/`
- manual code inspection of all renamed labels and routing/tab parsing
- `python -m graphify update .`

## Success Criteria
1. A dedicated `예약작업` tab exists in the main generation page.
2. Workflow schedules are no longer buried inside the Workflow page body tab stack.
3. The header mini popup can switch between `작업 큐` and `예약작업`.
4. Workflow-level `대기열` wording is replaced with `예약작업` where this IA change applies.
5. Frontend build passes.
