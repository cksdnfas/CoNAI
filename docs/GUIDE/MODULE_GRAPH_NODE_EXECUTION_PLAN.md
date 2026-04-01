# Module Graph Node Execution Plan

## Purpose

Define a practical execution model for the CoNAI module graph so users can:

- inspect intermediate node outputs
- understand node-by-node execution state directly in the graph
- run a selected node in a future partial-execution flow
- reuse stored execution artifacts safely when partial execution becomes available

This document is intentionally phased.
It separates what can be shipped immediately from what requires backend execution changes.

---

## Current State

The current module graph already has a useful execution foundation:

- saved graph workflows
- queued background workflow execution
- execution records
- per-node execution artifacts
- per-node execution logs
- execution detail UI with artifact and log inspection

What is still missing:

- direct node-level execute action
- partial execution from a selected node with automatic upstream coverage
- artifact reuse rules for safe cache-based execution
- inline graph-node previews for image/text outputs

---

## Design Goals

1. **Make intermediate results visible.**
   Users should see what a node produced without leaving the graph context.

2. **Keep workflow execution stable.**
   Existing whole-workflow execution must remain the default and must not regress.

3. **Add partial execution incrementally.**
   Node execution should be introduced in phases instead of landing as one large risky change.

4. **Reuse the existing artifact model.**
   The current `graph_execution_artifacts` and `graph_execution_logs` tables should remain the source of truth.

5. **Prefer clear execution semantics over aggressive caching.**
   A correct partial execution model matters more than a clever cache model.

---

## Execution Model

### Whole-workflow execution

The current workflow execution model remains valid:

- validate the graph
- topologically sort nodes
- execute all nodes in order
- persist artifacts and logs per node
- expose execution detail in the UI

### Future node execution

A future selected-node execution should behave like this:

1. User selects one node.
2. System determines the required upstream closure for that node.
3. System checks whether reusable artifacts already exist for required upstream outputs.
4. Missing upstream requirements are executed automatically.
5. The selected node executes.
6. The UI shows artifacts for all executed nodes and emphasizes the selected node result.

### First implementation boundary

The first implementation step does **not** add selected-node execution yet.
Instead, it adds inline node-result visibility on top of the current stored artifact model.

This gives immediate UX value while keeping backend execution behavior unchanged.

---

## Phased Plan

## Phase 1 — Inline node result visibility

### Scope

Use the already stored execution artifacts to show node-level previews directly inside graph nodes.

### Deliverables

- Node cards show artifact count for the selected execution.
- Node cards show an inline image preview when the node produced an image or mask.
- Node cards show an inline text summary when the node produced prompt/text/json output.
- Existing execution panel remains available as the detailed inspector.

### Non-goals

- no new execution API
- no partial execution logic
- no cache reuse logic
- no node-local rerun button yet

### Success criteria

- Selecting an execution updates node cards with execution state and inline preview data.
- Image-producing nodes show a visual thumbnail inside the graph.
- Text-producing nodes show a readable compact summary.
- Frontend build passes.

---

## Phase 2 — Selected-node execution without cache reuse

### Scope

Introduce a backend execution mode that runs only the selected node and the upstream nodes that are strictly required for it.

### Deliverables

- API endpoint for selected-node execution
- execution-plan generation for upstream closure
- selected-node execute action in the graph UI
- selected-node result focus in the execution detail UI

### Execution rule

If a required upstream dependency is not already provided within the same partial run, the executor runs that upstream node in the same execution.

### Success criteria

- A selected node can execute without running unrelated downstream branches.
- Required upstream nodes run automatically.
- Artifact/log output stays compatible with the existing execution detail views.

---

## Phase 3 — Safe artifact reuse for partial execution

### Scope

Allow partial runs to reuse prior artifacts when the system can prove they are still valid.

### Required validity inputs

Artifact reuse should eventually consider at least:

- workflow id
- workflow version
- node id
- module definition version or content signature
- effective resolved inputs for the node
- effective upstream dependency signatures

### Deliverables

- artifact reuse eligibility model
- execution option to prefer cache reuse
- execution option to force re-run
- UI hint that shows whether a node result was reused or freshly executed

### Success criteria

- Partial execution reuses valid upstream artifacts safely.
- Cache invalidation is deterministic and explainable.
- Users can force a clean run when needed.

---

## UI Plan

### Graph node surface

Each node card should be able to show:

- execution state (`idle`, `completed`, `failed`, `blocked`)
- artifact count
- latest artifact preview
- latest artifact label (port/type)

### Preview rules

- Prefer the latest image or mask artifact for visual preview.
- If there is no image artifact, prefer prompt/text/json summary.
- Keep previews compact so graph readability stays acceptable.
- Detailed logs and raw metadata remain in the execution panel.

### Detailed inspection

The existing execution panel continues to be the full inspector for:

- complete artifact list
- raw metadata
- logs
- timestamps
- failure details

---

## Backend Plan

### Keep

- `graph_executions`
- `graph_execution_artifacts`
- `graph_execution_logs`
- queued background execution flow
- current whole-workflow executor

### Add later

- selected-node execution API
- upstream-closure planner
- reusable artifact lookup logic
- artifact validity signatures

---

## Verification Checklist

### Phase 1

- [ ] selected execution updates node execution state in graph view
- [ ] image nodes show inline image preview
- [ ] text/prompt/json nodes show inline text summary
- [ ] execution panel still shows detailed artifact/log records
- [ ] frontend build passes

### Phase 2

- [ ] selected-node execution API works
- [ ] required upstream nodes execute automatically
- [ ] unrelated branches do not execute
- [ ] artifacts/logs are persisted normally
- [ ] frontend and backend builds pass

### Phase 3

- [ ] artifact reuse works deterministically
- [ ] stale artifacts are not reused incorrectly
- [ ] users can force re-run
- [ ] reused vs fresh output is visible in UI

---

## Implementation Decision

Implementation starts with **Phase 1**.

Reason:

- it delivers immediate value
- it uses the existing artifact storage model
- it improves graph usability before deeper executor changes
- it reduces risk before adding selected-node execution semantics
