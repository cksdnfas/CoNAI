# Module Graph Final Result Node Plan

## Background

The current workflow execution UI shows two similar result surfaces:

- `Workflow Runner` shows only one recent preview
- `Execution Results` shows multiple inferred final artifacts

These two surfaces are not backed by the same execution model.

Today, the system does **not** explicitly define what a workflow's final result is. The frontend infers likely final outputs by looking at terminal nodes and recent artifacts. That heuristic is not strong enough for the intended product behavior.

## Product Requirement

The workflow system must support **explicit final results**.

Requirements:

1. `Workflow Runner` and `Execution Results` must show the **same final results**
2. final results must show **all declared final outputs**, not only one representative preview
3. final results are **not** simply "each terminal node output"
4. workflows must be able to contain **multiple final-result nodes**
5. the final-result node must accept **any supported artifact data type**
6. final results must be recorded without duplicating stored artifact files

## Current Problems

### 1. Final results are inferred, not declared

Current frontend logic uses heuristics such as:

- terminal node detection
- selected target node preference
- latest visual artifact fallback

This means the UI does not know whether an artifact is truly intended as a final output.

### 2. Workflow Runner and Execution Results use different logic

- `Workflow Runner` uses one latest preview artifact
- `Execution Results` uses `pickFinalArtifacts(...)`

So the same workflow can show different result sets depending on the surface.

### 3. Storage semantics are not explicit

If node `A` generates an image and node `B` is intended to mark that image as final, the current model has no clean way to record:

- the original artifact created by `A`
- the fact that `B` declares that artifact to be final
- without duplicating file storage

## Design Decision

Introduce an explicit **Final Result node** plus a **final-result reference table**.

This makes final-result status a first-class execution concept instead of a UI heuristic.

## Proposed Execution Model

### 1. Add one built-in system module: `Final Result`

Properties:

- engine type: `system`
- authoring source: `manual`
- category: `output`
- accepts one input port named `value`
- input type must allow any workflow artifact type
- output ports are not required for this phase

Behavior:

- when executed, the node reads one upstream runtime artifact
- it does **not** duplicate or rewrite the artifact payload
- it records one final-result reference row for the execution
- it may optionally expose lightweight metadata for inspection, but it should not create duplicate binary artifacts

### 2. Add an explicit `any` module-port data type

Reason:
- the final-result node must accept image / mask / prompt / text / number / boolean / json / file-like artifacts
- current validation only allows exact type matches, plus prompt/text bridging

Scope:
- backend module graph types
- frontend module graph types
- backend edge validation
- frontend graph editor compatibility checks
- node-card display labels/colors

Compatibility rule:
- `any` input accepts all source data types
- `any` output is not needed in phase 1

## Storage Design

### Add a new table: `graph_execution_final_results`

Suggested columns:

- `id`
- `execution_id`
- `final_node_id`
- `source_artifact_id`
- `source_node_id`
- `source_port_key`
- `artifact_type`
- `created_date`

Recommended constraints:

- foreign key to `graph_executions(id)`
- foreign key to `graph_execution_artifacts(id)`
- unique `(execution_id, final_node_id)`

### Why a reference table instead of duplicating artifacts?

Because the final-result node does not create a new payload.

Example:
- node `A` generates an image
- node `B` (`Final Result`) points to the output from `A`

Correct behavior:
- the image artifact is stored once for node `A`
- the final-result table records that node `B` declares the artifact from `A` as final
- no extra image file is written
- no duplicate artifact row is needed for the same binary payload

This keeps execution storage normalized and prevents duplicate workflow output files.

## Runtime Behavior

### 1. Node execution

When the `Final Result` node executes:

- resolve the upstream incoming artifact for port `value`
- require exactly one incoming artifact value
- look up the corresponding stored artifact row for this execution
- write one row into `graph_execution_final_results`
- keep the runtime flow lightweight

### 2. Runtime lookup requirement

The executor currently stores runtime artifacts in memory by node/port and artifact rows in the database.

To support final-result registration cleanly, execution context should also be able to resolve the stored artifact row id for a node output.

Recommended approach:

- extend runtime artifact metadata to carry `artifactRecordId`
- populate it in:
  - `saveArtifactBuffer(...)`
  - `buildRuntimeArtifact(...)`
- then the final-result node can register the exact source artifact row without extra lookup hacks

## API Changes

### Extend execution detail payload

Current execution detail payload returns:

- `execution`
- `artifacts`
- `logs`

It should also return:

- `final_results`

Suggested final-result API shape:

- final result row metadata
- linked artifact row fields needed for rendering
- stable ordering for UI display

## UI Changes

### 1. Create one shared final-results section component

Suggested component:
- `WorkflowFinalResultsSection`

Responsibilities:
- render the final results for one execution
- show all final results consistently across surfaces
- reuse `ExecutionArtifactCard` or a close shared artifact surface
- show empty state when no final results exist

### 2. Replace both current result surfaces

#### Workflow Runner
Replace the current single-preview `최근 결과` block with the shared final-results section.

#### Execution Results
Replace the current heuristic `최종 결과` section with the same shared final-results section.

### 3. Remove heuristic final-result inference for final display

The final-results display should stop using terminal-node inference once explicit final-result rows exist.

The helper `pickFinalArtifacts(...)` can be retired or narrowed to legacy fallback only during migration.

## Migration Strategy

### Phase 1 — Foundation

- add `any` port type support
- add `graph_execution_final_results` table
- add model and API types
- seed the built-in `Final Result` system module
- teach runtime artifacts to retain created artifact row ids

### Phase 2 — Execution support

- implement `system.final_result` execution behavior
- register final-result reference rows without payload duplication
- extend execution detail APIs to include final results

### Phase 3 — UI unification

- add shared final-results section component
- make `Workflow Runner` and `Execution Results` use the same component
- remove single-preview-only runner logic
- stop using heuristic final-result selection for the main UI

### Phase 4 — Cleanup and legacy fallback review

- review whether terminal-node heuristic is still needed anywhere
- reduce dead helper logic if no longer used
- verify editor compatibility and validation messaging for `any` ports

## Key Files Likely Affected

### Backend
- `backend/src/types/moduleGraph.ts`
- `backend/src/database/userSettingsDb.ts`
- `backend/src/models/GraphExecutionArtifact.ts`
- `backend/src/models/GraphExecutionFinalResult.ts` (new)
- `backend/src/routes/graphWorkflows.ts`
- `backend/src/services/graphWorkflowExecutor.ts`
- `backend/src/services/graph-workflow-executor/shared.ts`
- `backend/src/services/graph-workflow-executor/artifacts.ts`
- `backend/src/services/graph-workflow-executor/validate.ts`
- `backend/src/services/graph-workflow-executor/execute-system.ts`

### Frontend
- `frontend/src/lib/api-module-graph.ts`
- `frontend/src/features/module-graph/module-graph-shared.tsx`
- `frontend/src/features/module-graph/module-graph-page.tsx`
- `frontend/src/features/module-graph/components/workflow-runner-panel.tsx`
- `frontend/src/features/module-graph/components/graph-execution-panel.tsx`
- `frontend/src/features/module-graph/components/graph-execution-panel-helpers.ts`
- `frontend/src/features/module-graph/components/execution-artifact-card.tsx`
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/module-graph/components/workflow-final-results-section.tsx` (new)

## Verification Checklist

1. the editor allows connecting any artifact type into the `Final Result` node
2. workflows can contain multiple final-result nodes
3. execution creates final-result reference rows without duplicate file storage
4. `Workflow Runner` and `Execution Results` show the same final-result set
5. final results show all declared final outputs
6. no inferred terminal-node output appears as final unless explicitly marked
7. existing workflow execution still succeeds for non-final-result graphs
8. frontend build passes
9. backend build passes

## Expected Outcome

After this work, the workflow system will have an explicit, normalized, reusable final-result model:

- final results are declared by workflow design
- execution storage stays deduplicated
- all result surfaces become consistent
- future workflow behavior becomes easier to reason about and maintain
