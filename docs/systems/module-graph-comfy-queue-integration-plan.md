# Module Graph Comfy Queue Integration Plan, 2026-04-22

## Goal
Make ComfyUI module nodes inside `generation?tab=workflows` run through the existing generation worker path instead of directly calling a stored ComfyUI endpoint.

This wave should restore the intended architecture:
- graph execution queue = orchestration queue
- generation queue = concrete ComfyUI or NAI worker queue

Both queues should coexist.
They serve different purposes.
They should both remain visible.

## Product Intent
When a saved ComfyUI workflow is wrapped as a reusable module and used as a graph node:
- the node should support the same routing modes already used by normal ComfyUI generation
  - automatic assignment
  - tag-based routing
  - explicit server selection
- the actual ComfyUI job should be registered in the existing `generation_queue_jobs` pipeline
- the normal ComfyUI queue and history surfaces should show that work
- the graph runtime should wait for completion, then hand the produced files and metadata to downstream graph nodes as graph artifacts

This is not a queue merge.
It is a queue-boundary correction.

## Core Architectural Rule
### Graph queue responsibilities
The graph execution system should remain responsible for:
- execution order
- dependency validation
- runtime input application
- node-level cancellation and rerun flow
- graph execution logging
- graph artifact persistence and downstream handoff

### Generation queue responsibilities
The generation queue should remain responsible for:
- ComfyUI and NAI worker job creation
- server routing
- workflow-linked server eligibility
- tag-based routing
- automatic server assignment
- queue lane calculation
- provider job tracking
- generation history creation
- output persistence in the normal generation pipeline

### Required boundary
A Comfy module node should not directly submit to ComfyUI.
It should enqueue a normal generation job, wait for the result, then translate the result into graph artifacts.

## Current Findings
### What already works in the normal ComfyUI path
Normal ComfyUI generation already supports the intended routing model.

Relevant frontend and backend paths:
- `frontend/src/features/image-generation/components/comfy-workflow-controller-panel.tsx`
- `frontend/src/features/image-generation/components/use-comfy-generation-actions.ts`
- `backend/src/routes/generation-queue.routes.ts`
- `backend/src/services/generationQueueRouting.ts`
- `backend/src/services/generationQueueService.ts`
- `backend/src/models/GenerationQueue.ts`
- `backend/src/models/GenerationHistory.ts`
- `backend/src/services/generationHistoryService.ts`

Existing behavior:
- `requested_server_id` = explicit server
- `requested_server_tag` = tag-based routing
- neither field = automatic assignment
- workflow-linked eligible-server filtering already exists
- queue and history UIs already understand these fields

### What the graph/module path currently does
ComfyUI module execution inside the graph runtime is currently separated from that worker path.

Relevant paths:
- `backend/src/routes/moduleDefinitions.ts`
- `backend/src/routes/graphWorkflows.ts`
- `backend/src/services/graphWorkflowExecutionQueue.ts`
- `backend/src/services/graphWorkflowExecutor.ts`
- `backend/src/services/graph-workflow-executor/execute-comfy.ts`

Current behavior:
- wrapping a ComfyUI workflow stores `workflow_json`, `marked_fields`, and `api_endpoint` in `template_defaults`
- graph execution is queued through `GraphWorkflowExecutionQueue`
- `execute-comfy.ts` creates a Comfy service directly from the stored `api_endpoint`
- the node submits to ComfyUI directly, waits directly, downloads outputs directly, and persists graph artifacts directly

Result:
- no existing generation queue job is created
- no normal Comfy queue lane is used
- no normal worker routing mode is used
- no node-level server target setting exists yet
- the reusable module behaves like a direct endpoint runner instead of a queue-backed worker task

### Why node-level routing is the right configuration boundary
The graph system already has broad node-instance configuration support through `node.input_values` and `module.ui_schema`.

Relevant frontend surfaces already edit and persist per-node values:
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/module-graph/use-module-graph-page-view-model.ts`
- `frontend/src/features/module-graph/use-module-graph-editor-interactions.ts`
- `frontend/src/features/module-graph/module-graph-shared.tsx`
- `frontend/src/lib/api-module-graph.ts`

This means server-target mode should be stored per graph node instance, not globally per reusable module definition.
That keeps one module reusable across many graphs and many routing strategies.

## Desired End State
For a ComfyUI-backed module node:
1. graph execution reaches the node
2. graph runtime resolves the node's routing target
3. graph runtime creates a normal ComfyUI generation queue job
4. generation queue performs routing and execution
5. normal generation history and queue surfaces show the work
6. graph runtime waits for the resulting history/output record
7. graph runtime converts the saved result into graph artifacts
8. downstream nodes consume those artifacts normally

The graph queue remains the parent execution layer.
The generation queue remains the worker execution layer.

## Non-Goals For This Wave
Out of scope for this implementation wave:
- merging graph execution records and generation queue records into one table
- removing the graph execution queue
- redesigning the entire module system
- rewriting normal ComfyUI generation routing
- broad UI redesign of the workflow editor
- replacing generation history with graph artifact storage
- expanding this wave into a full NAI graph-integration redesign unless the same seam is intentionally reused afterward

## Recommended System Shape
### 1. Keep graph orchestration, replace direct Comfy execution
The graph execution engine should still call a Comfy-node executor.
But that executor should stop talking to ComfyUI directly.

Instead it should:
- build the queue payload from the wrapped workflow and resolved node inputs
- enqueue one normal generation job
- wait for queue completion and resulting saved output
- convert the result into graph artifacts

### 2. Store routing mode per node instance
Recommended node-level fields:
- `execution_target_mode`: `auto | tag | server`
- `execution_target_tag`: optional string
- `execution_target_server_id`: optional number

These can live in `node.input_values` so the graph document remains the source of truth.

The reusable module definition should stay generic.
Avoid baking one server target into the module definition itself.

### 3. Preserve source workflow identity
Wrapped Comfy modules should keep enough source metadata to build a normal queue job:
- `source_workflow_id`
- workflow name
- `workflow_json`
- `marked_fields`

A stored raw `api_endpoint` should no longer be treated as the primary execution contract.
If kept for backward compatibility, it should be treated as legacy fallback only.

## Reuse Strategy And Duplication Guardrails
This is the most important maintainability rule for the wave.
Do not implement a second Comfy execution stack inside the graph runtime.

### Reuse candidates
#### A. Queue payload shape
Reuse the existing Comfy queue payload contract already used by normal generation.

Current reference:
- `frontend/src/features/image-generation/components/use-comfy-generation-actions.ts`
- `backend/src/routes/generation-queue.routes.ts`
- `backend/src/types/generationQueue.ts`

Do not invent a graph-only Comfy job schema.

#### B. Server routing rules
Reuse:
- requested server id handling
- requested server tag handling
- auto assignment behavior
- workflow-linked server filtering

Current reference:
- `backend/src/services/generationQueueRouting.ts`

Do not copy routing validation into graph-only code.

#### C. Result and history resolution
Reuse the normal generation history and queue linkage.

Current reference:
- `backend/src/models/GenerationHistory.ts`
- `backend/src/services/generationHistoryService.ts`
- `backend/src/routes/workflows/execution.routes.ts`

The graph runtime should resolve output from normal saved generation results rather than implementing a second download-and-save flow.

#### D. Frontend routing option presentation
The graph editor should reuse the same conceptual target options already shown in the ComfyUI workflow controller:
- auto
- tag
- explicit server

Current reference:
- `frontend/src/features/image-generation/components/comfy-workflow-controller-panel.tsx`

Ideally the option-building logic should be extractable into a shared helper instead of being rebuilt a second time.

### Duplication traps to avoid
Do not duplicate any of the following inside graph-specific code:
- routing-tag normalization rules
- queue-job request body validation logic
- workflow-linked server eligibility checks
- Comfy request-debug snapshot flow
- generation history creation rules
- saved-output resolution and representative-output selection rules
- direct file download logic that already belongs to the normal generation path

### Recommended refactor seams
If the current code is too route-bound for clean reuse, extract shared seams rather than copying route logic.

Recommended seams:
1. `createComfyGenerationQueueJob(...)`
- shared service/helper for creating a queue job from a workflow + prompt data + routing target
- usable by normal UI routes, public workflow routes, and graph execution

2. `buildComfyRoutingRequest(...)`
- shared helper for converting `auto | tag | server` into queue fields
- prevents frontend/backend drift

3. `waitForQueueJobResult(...)`
- shared helper used by graph execution to block until queue completion and resolve the resulting history/output row

4. `buildGraphArtifactsFromGenerationResult(...)`
- graph-side adapter that converts one completed generation result into graph artifacts
- this should be the graph-specific step, not the upstream Comfy execution itself

## Planned File Touchpoints
### Backend
Primary files likely involved:
- `backend/src/services/graph-workflow-executor/execute-comfy.ts`
- `backend/src/services/graphWorkflowExecutor.ts`
- `backend/src/services/graphWorkflowExecutionQueue.ts`
- `backend/src/routes/moduleDefinitions.ts`
- `backend/src/routes/generation-queue.routes.ts`
- `backend/src/services/generationQueueService.ts`
- `backend/src/services/generationQueueRouting.ts`
- `backend/src/models/GenerationQueue.ts`
- `backend/src/models/GenerationHistory.ts`
- `backend/src/services/generationHistoryService.ts`
- `backend/src/types/moduleGraph.ts`
- `backend/src/types/generationQueue.ts`

Possible supporting additions:
- a new shared queue-job creation helper under `backend/src/services/`
- a graph adapter that turns generation history/output data into graph artifacts

### Frontend
Primary files likely involved:
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/module-graph/module-graph-shared.tsx`
- `frontend/src/features/module-graph/use-module-graph-page-view-model.ts`
- `frontend/src/features/module-graph/use-module-graph-editor-interactions.ts`
- `frontend/src/lib/api-module-graph.ts`
- `frontend/src/features/image-generation/components/comfy-workflow-controller-panel.tsx`

Possible supporting additions:
- shared target-option helper for module-graph and normal Comfy workflow panels
- small typed constants for node-level execution target keys

## Implementation Plan
## Phase 1. Document the execution contract
Write and approve the boundary first.

Required outcomes:
- graph queue remains orchestration
- generation queue remains worker queue
- wrapped Comfy nodes must enqueue worker jobs
- node-level routing is the chosen configuration boundary
- duplicate execution stacks are explicitly forbidden

## Phase 2. Add node-level routing fields
Add graph-node support for:
- auto
- tag
- explicit server

Implementation direction:
- store values in `node.input_values`
- surface them in the node inspector for Comfy modules only
- keep labels compact and consistent with existing Comfy routing UI

Verification:
- graph save/load preserves these fields
- node duplication and copy/paste preserve these fields
- graph execution payload sees the configured values

## Phase 3. Introduce shared queue-job creation seam
Move queue-job creation logic out of route-only handling if needed.

Target outcome:
- graph execution can create a generation queue job without reimplementing route validation and payload assembly
- public workflow queueing and normal workflow queueing can continue using the same seam

Verification:
- existing queue-creation behavior remains unchanged
- explicit server, tag, and auto all still validate correctly

## Phase 4. Replace direct Comfy submission in graph executor
Refactor `execute-comfy.ts`.

New behavior:
- resolve node input values
- build the normal Comfy queue payload
- enqueue a normal generation queue job
- wait for queue completion
- resolve saved output and metadata
- create graph artifacts from that result

Old behavior to remove from the primary path:
- direct `createComfyUIService(apiEndpoint)` execution
- direct prompt submission from graph runtime
- direct history polling against a stored endpoint
- direct output download into graph temp files as the main path

## Phase 5. Add cancellation and failure bridging
Graph cancellation should propagate safely.

Target outcome:
- cancelling a running graph execution requests cancellation for the underlying queue job when possible
- queue failure becomes node failure with clear graph logs
- graph logs include queue job id and history id for traceability

## Phase 6. Tighten legacy compatibility rules
After the queue-backed path is stable:
- reduce the role of `template_defaults.api_endpoint`
- keep legacy fallback only if migration pressure requires it
- document when fallback is allowed and when it is not

## Parallel Delivery Strategy
This work is suitable for parallel sub-agent or lane-based delivery once the contract is approved.

### Track A. Frontend node configuration lane
Scope:
- add node-level routing fields
- render compact UI in graph node inspector
- preserve graph document compatibility
- reuse shared target option logic where possible

Primary focus:
- do not add a second target-option implementation if a shared helper can cover both surfaces

### Track B. Backend queue integration lane
Scope:
- extract reusable queue-job creation seam if required
- refactor graph Comfy execution to enqueue and wait
- reuse existing generation queue and history behavior

Primary focus:
- do not duplicate Comfy execution flow already owned by generation queue service

### Track C. Result handoff and graph artifact lane
Scope:
- convert completed generation results into graph artifacts
- persist metadata needed for downstream graph usage and debugging
- align graph logs with queue job id and history id

Primary focus:
- graph should adapt results, not own upstream worker execution logic

Recommended order:
1. approve this plan
2. start Track A and Track B in parallel
3. land shared seams before final graph-executor cutover if both tracks need them
4. finish Track C once the backend queue contract is stable
5. run combined verification

## Verification Plan
### Functional verification
1. Save one wrapped ComfyUI module and place it in a graph.
2. Configure the node for each routing mode:
   - auto
   - tag
   - explicit server
3. Execute the graph.
4. Confirm both layers appear:
   - graph execution entry in graph execution UI
   - worker job entry in normal generation queue UI
5. Confirm queue and history rows show the expected server lane and routing state.
6. Confirm the graph node receives a usable file artifact after completion.
7. Confirm a downstream node can consume that artifact.
8. Confirm graph cancellation behavior is sane when the worker job is queued or running.

### Regression verification
- normal ComfyUI workflow queue registration still works
- public workflow queue registration still works
- explicit workflow-linked server validation still works
- queue lane display remains correct for auto, tag, and explicit server
- graph save/load and node duplication do not drop routing configuration

### Build verification
- `npm run build:frontend`
- `npm run build:backend`

## Risks And Unknowns
### 1. Queue wait semantics inside graph execution
Graph execution currently expects node-local completion semantics.
A queue-backed path needs a clear waiting strategy without breaking graph cancellation or reuse behavior.

### 2. Output resolution contract
The graph runtime needs a stable way to resolve the correct saved output from generation history.
This must be explicit for:
- single representative image
- video outputs
- future multi-output support

### 3. Legacy `api_endpoint` dependence
Wrapped modules currently capture `api_endpoint` as part of their defaults.
Switching to queue-backed execution should not silently break older modules, but the system should stop treating that field as the preferred execution contract.

### 4. Route-bound validation today
Some queue creation rules currently live close to route handling.
If reused badly, the graph executor could duplicate backend validation instead of calling one shared seam.

### 5. Reuse of current graph node UI schema
Node-level routing fields should fit the current node inspector and graph document model cleanly.
This is likely safe because node-instance `input_values` already exist widely, but the final UI should stay compact.

## Success Criteria
1. A ComfyUI module node can choose auto, tag, or explicit server routing.
2. Running that node creates a normal generation queue job instead of directly calling a stored endpoint.
3. The existing worker queue and generation history surfaces show the work.
4. The graph execution remains separate and still tracks the larger orchestration run.
5. Completed outputs are handed back into the graph as usable artifacts.
6. No second Comfy execution stack is introduced inside graph-specific code.
7. Frontend and backend builds pass after implementation.

## Final Recommendation
Treat this as an architectural correction, not a feature add-on.

The clean solution is:
- keep graph execution as the parent orchestrator
- keep generation queue as the worker layer
- move wrapped Comfy module execution back onto the existing Comfy queue path
- make graph runtime responsible only for configuration, waiting, and artifact handoff
- reject any implementation that reintroduces duplicated routing or direct upstream Comfy execution logic
