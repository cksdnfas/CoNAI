# Module Graph Execution Results Rework Plan

## Status

Deferred for later implementation while current DB-related work is in progress.

This document captures the agreed direction for simplifying the module-graph execution results UX for general users, while preserving deeper technical visibility behind an explicit detail surface.

## Background

The current execution results panel is too technical for ordinary users.

Today, the panel exposes raw execution artifacts, storage paths, logs, and raw JSON-style metadata directly in the main surface. That is useful for debugging, but it is not a good default experience for users who mainly want to understand:

- what input values were used in this run,
- what each node produced,
- and what the final output was.

A raw JSON block is especially poor as a default presentation. Even when technically correct, it is not self-explanatory for non-technical users.

## UX Direction

### Primary rule

The default execution results surface should be a **user-facing summary**, not a debug console.

### What the default surface should show

For the selected execution, the main panel should focus on:

1. **Run summary**
   - execution id
   - status
   - created/completed time
   - optional short execution mode label (full run / node run / forced rerun)

2. **User input values used for this run**
   - workflow runtime inputs actually supplied by the user
   - readable labels instead of internal ids
   - friendly rendering by data type

3. **Node outputs**
   - grouped by node
   - readable node label
   - output label and formatted value preview
   - images as thumbnails
   - text as text blocks
   - structured JSON rendered as readable key-value summaries instead of raw blobs when possible

4. **Final outputs**
   - visually emphasized section
   - image gallery, text result card, or file/result list depending on output type
   - intended to answer: "What did this run finally produce?"

5. **Details button**
   - opens a modal or popup for technical details

### What should move out of the default surface

The following information should not dominate the main results panel:

- raw JSON payloads
- storage paths
- node internal ids / port internal keys as primary labels
- verbose logs
- cache/reuse implementation details
- low-level technical metadata

Those are still useful, but they belong in a secondary detail experience.

## Proposed Information Architecture

### A. Execution history list

Keep the execution list, but simplify the visible metadata.

Recommended visible items per history row:

- execution id
- status badge
- timestamp
- optional short summary label such as:
  - `Workflow Run`
  - `Node Run`
  - `Forced Rerun`

Optional secondary metadata:

- error snippet for failed runs
- queue/running state when relevant

Avoid overloading the history list with technical implementation details.

### B. Main result summary panel

For the currently selected execution, show sections in this order:

#### 1) Summary
- run type
- status
- created time
- completed time
- short user-facing explanation if failed

#### 2) Inputs used in this run
- render only meaningful user-facing inputs
- hide empty/default/internal-only noise unless explicitly expanded
- show input source if helpful:
  - user-provided
  - default applied
  - auto-filled from upstream

#### 3) Node outputs
- card/list grouped by node
- each node card should show:
  - node display name
  - key outputs only
  - preview appropriate to artifact type
- if a node produced both an image and metadata, prefer the image in the summary and keep the rest in details

#### 4) Final outputs
- highlight outputs likely to matter most to the user
- should feel like the answer/result area, not a raw dump

#### 5) Details action
- `View Details`
- opens a modal instead of expanding the main panel into a debug page

### C. Detail modal

The detail modal is the correct place for technical inspection.

Recommended sections:

1. Execution meta
   - execution id
   - workflow version
   - target node id if this was a node run
   - force rerun flag
   - cache reuse information

2. Full node-by-node breakdown
   - inputs resolved for each node
   - outputs emitted by each node
   - raw artifact metadata when needed

3. Logs
   - grouped and styled by level
   - hidden by default behind a section/toggle if needed

4. Raw JSON / advanced debug data
   - explicit advanced section
   - clearly treated as developer-facing information

## Data Presentation Rules

### Show meaning, not raw structure

The UI should render values according to user meaning rather than backend storage shape.

#### Text / prompt
- show as readable text blocks
- preserve line breaks
- avoid forcing JSON formatting unless the value is truly machine-structured

#### Number / boolean / select
- show as labeled values
- for booleans, prefer user-friendly wording over `true` / `false` when possible

#### Image / mask
- show thumbnail preview
- allow click-to-enlarge

#### JSON
- first attempt a friendly summary view
- only show raw JSON in detail mode or an explicit advanced section

#### File
- show file label, type, and action if relevant
- avoid leading with full storage path

## Important Backend / Data Considerations

This rework is not only a frontend presentation change.

### 1) Per-execution runtime input snapshot is likely needed

The requested summary includes **the values the user entered for that specific run**.

Current execution records appear to store workflow id, version, status, plan, timestamps, and failure state, but not a dedicated persisted snapshot of runtime input values for each execution.

That means the following should be evaluated before implementation:

- whether the execution record should persist `input_values_json` (or equivalent),
- whether the backend should expose a normalized `resolved_inputs` / `runtime_inputs` payload in execution detail responses,
- how defaults vs explicit user inputs should be distinguished.

Without a persisted execution input snapshot, the UI may only be able to infer or partially reconstruct what happened.

### 2) User-facing labels need stable resolution

The summary UX depends on readable labels for:

- workflow exposed inputs
- node display names
- output port labels
- final result identification

That means the execution detail surface may need either:

- enough data to reconstruct labels from the current workflow/module definitions,
- or a stored snapshot that preserves labels as they were at execution time.

### 3) Final output identification should be explicit

The UI needs a reliable way to identify which outputs count as the final result(s).

Possible strategies:

- infer from terminal nodes with no outgoing edges,
- allow explicit module/output flags for final outputs,
- or let the backend provide a `final_outputs` section in the execution detail response.

A backend-provided `final_outputs` structure would simplify frontend logic and reduce guesswork.

## Recommended Implementation Strategy

### Phase 0 — Documentation and alignment
- keep this plan as the agreed direction
- do not implement until DB work settles

### Phase 1 — Summary-first UI with current data
Goal: reduce information overload without waiting for full backend changes.

Frontend work:
- simplify `graph-execution-panel.tsx`
- replace artifact dump emphasis with user-facing grouped summaries
- move raw JSON and logs behind a detail affordance
- add a detail modal shell

Limitations in this phase:
- per-run user input display may be partial if execution input snapshots are not persisted yet
- final output detection may need heuristics

### Phase 2 — Backend data support
Goal: make the summary accurate and stable.

Backend work to consider:
- persist runtime input snapshot per execution
- expose normalized execution summary data
- optionally expose final outputs explicitly
- optionally expose node output summary labels instead of only raw artifact rows

Potential backend touchpoints:
- `backend/src/database/userSettingsDb.ts`
- `backend/src/models/GraphExecution.ts`
- `backend/src/routes/graphWorkflows.ts`
- graph execution service / artifact assembly logic

### Phase 3 — Full detail modal and advanced debug separation
Goal: cleanly separate user mode from technical mode.

Frontend work:
- add dedicated execution detail modal component
- split summary view from debug view
- hide raw JSON and logs in advanced sections
- improve type-specific rendering for structured data

## Suggested Frontend Touchpoints

Likely files to revisit later:

- `frontend/src/features/module-graph/components/graph-execution-panel.tsx`
- `frontend/src/features/module-graph/module-graph-page.tsx`
- possibly shared helpers in `frontend/src/features/module-graph/module-graph-shared.tsx`

Possible new components:

- `execution-result-summary.tsx`
- `execution-node-output-list.tsx`
- `execution-detail-modal.tsx`
- `execution-value-renderer.tsx`

## Non-Goals

This rework should not:

- change graph execution semantics,
- change queue/cancel/retry behavior,
- redesign the graph canvas itself,
- or remove technical detail access completely.

The goal is **better default presentation**, not loss of debugging capability.

## Open Questions

1. Should the main panel show only explicitly user-provided runtime inputs, or also show defaults that became effective during the run?
2. How should final outputs be identified when multiple terminal nodes exist?
3. Should node outputs in the summary show only the most important output per node, or all outputs with compact rendering?
4. Should the detail modal include raw logs by default, or hide them behind an advanced toggle?
5. Should execution detail reflect the workflow/module labels at execution time, or always resolve against the latest current definitions?

## Recommendation

When implementation resumes, start with a small summary-first pass instead of a full rewrite.

Best order:

1. simplify the main panel,
2. add a detail modal,
3. then extend backend data support if the current API cannot provide accurate per-run inputs and final-output summaries.

This keeps the graph canvas stable while improving the surrounding workflow panel experience first.
