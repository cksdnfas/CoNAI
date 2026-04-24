# Module Graph Node UX Redesign Plan, 2026-04-24

## Goal
Redesign the workflow node experience in `generation?tab=workflows` so it feels much closer to ComfyUI:
- all ports stay visible on the node at all times
- common values are editable directly beside their ports
- connection handles live alongside the editable controls
- type information is communicated primarily through color and tiny visual markers, not large text badges
- the node stays visually plain and compact without decorative card layers, nested callouts, or extra descriptive copy
- the inspector/modal becomes a secondary surface for advanced editing, not the primary way to configure ordinary nodes

This is a usability-first redesign.
The main problem is not missing capability.
The main problem is that the current editing flow hides too much state outside the canvas.

## Product Intent
The canvas should become the main authoring surface.
A user should be able to:
- understand what a node is doing without opening a modal
- change the most important values without leaving the canvas
- see whether a value is connected, manually overridden, defaulted, or missing
- build and tune a workflow through direct node interaction instead of repeatedly bouncing between node cards and the inspector

The target bar is not just “slightly better than today”.
The target bar is “close to ComfyUI-level authoring comfort” while still fitting CoNAI's own module system.

## Current Problems
### 1. Nodes are visually busy in the wrong way
Today many node cards spend too much space on type chips, summary text, and decorative surfaces while still forcing real editing into the inspector.
That means the canvas is neither minimal nor comfortably editable.

### 2. Important values are hidden outside the node
Most real editing still happens in:
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- modal-based flows for larger inputs

As a result, values changed elsewhere are often not visible on the node itself.
Users lose “at a glance” understanding.

### 3. Type labels consume too much node space
Current node cards spend meaningful space on repeated type chips such as `text`, `prompt`, `json`, `image`, and so on.
That information is useful, but the current presentation is too heavy for the default view.

### 4. Node cards do not present editing priority clearly
Some fields matter constantly.
Some are advanced.
Some are only relevant when troubleshooting.
Right now the UI does not strongly separate those layers.

## Current Code Findings
### Main node surface
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`

Current characteristics:
- fixed card width (`w-[340px]`)
- strong emphasis on `PortCell` rows
- repeated visible type badges per port
- only a few special nodes currently support real inline editing

### Current editing surface
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`

Current characteristics:
- owns most editable input renderers
- supports many data types already
- acts as the primary configuration surface for ordinary nodes

### Existing inline inspiration already inside the codebase
- `frontend/src/features/image-generation/components/comfy-workflow-authoring-graph.tsx`

This is important because the codebase already has a node-card pattern that renders editable rows inside the node itself.
That means the redesign does not need a new UX philosophy from scratch.
It mainly needs the module-graph editor to adopt the same direction systematically.

## Core UX Principles
### 1. Canvas-first authoring
The default workflow should happen on the canvas.
Users should not need to open the inspector just to change common fields.

### 2. Visible state beats hidden state
Every important manual override should be visible directly on the node.
If the user changed a value, the node should show that fact immediately.

### 3. Type should be mostly visual, not verbose
Port type should be communicated through:
- color
- handle styling
- compact icons or dots when needed
- tooltip details on hover

Large repeated type text should be the exception, not the default.

### 4. Priority-based editing
Each node field should fall into one of these groups:
- **inline core**: common, high-frequency fields shown directly on the node
- **inline summary**: shown as current-value summary but edited elsewhere when necessary
- **advanced**: inspector-only or modal-only

### 5. Keep nodes readable
This redesign should not turn every node into a huge form.
The goal is “direct editing where it matters most”, not “render every possible field inline”.

## Target Node Layout
## 1. Header
The node header should contain only the essentials:
- drag handle
- node title
- optional custom label
- compact state chips such as `missing`, `completed`, `failed`, `cached`

Do not add summary strips, helper subtitles, or explanatory copy under the header.

## 2. All-port inline body
The body of the node should keep all ports visible.
Each row should be as plain as possible:
- input handle
- field label
- tiny type marker
- compact editor or value surface when that port is editable inline
- output handle where applicable

Do not split the node into a summary section plus a separate port section.
If all ports are already visible, summary strips are unnecessary noise.

## 3. Port rows integrated with content
Ports should feel like part of the editable row, not like a separate socket table.
Preferred structure:
- input handle aligned with the field row
- output handle aligned with the row or output slot it belongs to
- handle color defines most type identity
- detailed type name moves to tooltip or modal-side detail
- visible type text on the node is minimized to rare special cases only

## 4. Advanced section access
Nodes may still expose:
- `More`
- `Advanced`
- `Open Inspector`

But that should feel like expanding beyond the common path, not entering the only usable path.

## Proposed Information Hierarchy
### Always visible
- node name
- execution state
- required-missing state
- all ports
- current inline-editable values beside their ports

### Visible on hover or tooltip
- full type name
- internal port key
- detailed description
- bridge rules such as `text ↔ prompt`

### Hidden behind inspector or modal
- large JSON payloads
- long-form prompts
- multi-item complex editors
- detailed descriptions and technical explanation text
- diagnostic or low-frequency options

## Field Placement Rules
### Inline core candidates
A field should be inline when most of these are true:
- frequently edited during normal workflow authoring
- short enough to fit without harming readability
- important to compare across nodes
- useful to understand at a glance

Typical examples:
- model selector
- sampler selector
- steps
- cfg
- seed mode / seed value
- execution target selector
- enable/disable toggles
- short string transform values

### Inspector-only candidates
Keep these out of the node by default:
- long JSON
- long prompt bodies
- complex repeatable arrays
- multi-section advanced configuration
- debugging-only values

## Port Type Presentation Rules
### Default representation
Replace heavy type chips with lighter defaults:
- port handle color = primary type cue
- tiny icon or dot near the field label = secondary cue
- hover tooltip = full type label and description

### Exceptions
Keep explicit text only when the type difference is genuinely important and not obvious visually.
Examples:
- rare bridge behavior
- ambiguous `any` ports
- ports with special runtime semantics

### Result
The node surface should read as “plain editable rows with sockets”, not “type documentation with sockets” and not “dashboard cards”.

## Required Interaction States
Each editable field on a node should make the current source of value obvious:
- connected
- manually set
- using default
- required and missing
- disabled by mode

This can be shown with compact row styling such as:
- left accent bar
- small status dot
- subtle background variation
- tiny source chips like `linked`, `manual`, `default`

## Inspector Role After Redesign
The inspector should remain valuable, but its role changes.
It should become the place for:
- advanced configuration
- bulk field review
- long-form editing
- complex structures
- debugging and technical inspection

It should no longer be the main path for ordinary field changes.

## Implementation Strategy
## Wave 1: Create shared inline-field building blocks
Primary target files:
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- supporting shared helpers under `frontend/src/features/module-graph/`

Tasks:
- extract reusable field renderers from the inspector
- allow node cards to render the same field controls inline
- keep behavior and data binding identical across node and inspector surfaces

This is the most important maintainability step.
Do not fork two unrelated editor implementations.

## Wave 2: Introduce node-level field placement rules
Add a consistent way to decide which fields belong inline.
Possible options:
- infer from `ui_schema`
- add explicit UI hints such as `display: inline | summary | advanced`
- add an `inline_priority` number for sorting

Recommendation:
start with conservative heuristics for existing modules,
then add explicit schema hints where needed.

## Wave 3: Reduce port chrome
Refactor `PortCell` presentation so default node space is spent on values, not on type labels.
Tasks:
- shrink or remove repeated type chips
- move type details into tooltip
- keep color as the dominant port-type signal
- preserve accessibility and discoverability through hover text

## Wave 4: Keep output and special nodes visually plain
As the redesign expands:
- output nodes should stay as minimal as ordinary nodes
- artifact surfaces should avoid large decorative framing
- descriptions should remain off the main node surface
- special layouts should still preserve the same plain row rhythm

## Wave 5: Module-specific polishing
Apply special layouts where they materially improve usability.
Examples:
- generation modules
- Comfy-backed reusable modules
- text transform modules
- workflow input source modules
- final result/output nodes

These can go beyond the generic layout when that produces a clearly better authoring experience.

## Non-Goals
This redesign is not about:
- rewriting graph execution logic
- changing module persistence format unless needed for UI hints
- merging every advanced editor into the node body
- making every node visually identical to ComfyUI

The goal is equivalent authoring comfort, not visual cloning.

## Risks And Guardrails
### Risk: nodes become too tall
Mitigation:
- only inline high-value fields
- keep advanced fields collapsed
- support compact summaries instead of full editors everywhere

### Risk: duplicated editor logic
Mitigation:
- extract shared field renderer helpers
- do not maintain separate input behavior between node card and inspector unless intentionally required

### Risk: inconsistent module experiences
Mitigation:
- define common placement rules
- allow module-specific overrides only for clear UX wins

### Risk: type discoverability drops too far
Mitigation:
- keep strong port color language
- retain robust tooltips
- use minimal icons for ambiguous cases

## Acceptance Criteria
This redesign is successful when the following are true:
1. A user can edit the most common node values directly on the canvas.
2. A user can understand a node's current important values without opening the inspector.
3. Port type text no longer dominates node space.
4. Inspector usage decreases for ordinary edits and remains useful for advanced edits.
5. Typical authoring flow feels closer to ComfyUI: edit on node, wire on node, review on node.

## Recommended First Implementation Slice
The safest first slice is:
1. introduce reusable inline field renderers
2. enable inline editing for the most common simple field types beside their ports
   - select
   - number
   - boolean
   - short text
3. shrink port type chrome into dots / tiny markers / tooltips
4. keep every port visible in a single plain layout without summary strips

That first slice should already produce a major usability improvement without requiring a full redesign of every module.

## Concrete Starting Points
Start implementation from these files:
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- `frontend/src/features/module-graph/module-graph-shared.tsx`
- `frontend/src/features/image-generation/components/comfy-workflow-authoring-graph.tsx` as an inline-pattern reference

## Final Direction
The future CoNAI module graph should feel like this:
- nodes are understandable without opening extra UI
- common values are editable directly where the workflow is built
- all ports remain visible in a clean single layout
- ports support the editing surface instead of visually overwhelming it
- the canvas becomes the primary authoring experience

That is the standard this redesign should aim for.
Close to ComfyUI-level usability is the right target.
