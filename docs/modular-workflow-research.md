# Modular Workflow Research

## Goal
Build a modular image-generation workflow system where NAI modules and ComfyUI modules can be connected like nodes in a graph.

Examples:
- NAI text-to-image -> ComfyUI image-to-image
- ComfyUI output image -> NAI infill input
- Prompt/text/settings modules -> generator modules

## What exists in the current codebase

### Frontend
- No graph editor library is currently installed.
- Current frontend stack is React 19 + Vite + TanStack Query + Tailwind-style UI primitives.
- Current image generation page is form-based, not graph-based.

### Backend
- Existing `workflows` model is ComfyUI-centric:
  - stores `workflow_json`
  - stores `marked_fields`
  - execution assumes a ComfyUI workflow submission path
- Current NAI path is request-based, not graph-module-based.
- There is no generic module graph schema yet.
- There is no generic typed port/edge execution engine yet.

## Library candidates

### 1. React Flow / @xyflow/react
**Best fit for CoNAI UI layer**

Strengths:
- React-first and widely used for node-based editors
- Excellent custom node support
- Built-in drag/select/pan/zoom/minimap/controls
- Easy to integrate with current React app
- Good for graph editing UX
- Strong ecosystem and active maintenance

Weaknesses:
- It is primarily a graph UI toolkit, not a full execution engine
- Type-safe ports/data flow rules must be implemented by us
- Auto-layout may need an extra library later (dagre / elkjs)

Use if:
- We want the cleanest path to a production React graph editor
- We are comfortable implementing our own module schema and executor

### 2. Rete.js
**Best fit if the execution graph engine itself should be framework-driven**

Strengths:
- Built for visual programming
- Includes engine-oriented concepts beyond drawing nodes
- TypeScript-first and processing-oriented
- Good for more opinionated node systems

Weaknesses:
- Heavier conceptual model than React Flow
- Integration/customization cost is higher for a React product UI
- May be overkill for first version if we mainly need graph editing + backend execution

Use if:
- We want the node engine model to dominate the system design from day one
- We are willing to accept more upfront complexity

### 3. LiteGraph / @comfyorg/litegraph
**Only useful as a reference, not the recommended primary choice**

Strengths:
- Very close to the ComfyUI mental model
- Canvas-based node editor similar to ComfyUI

Weaknesses:
- Poorer fit for the current React UI architecture
- The Comfy docs themselves describe Comfy UI as being built on top of LiteGraph, but this does not mean it is the best fit for this app
- More awkward to integrate into modern React component structure
- Archived upstream signal exists around Comfy-Org litegraph repo history, so risk is higher than React Flow

Use if:
- We deliberately want a ComfyUI-like clone UX over React-native product integration

### 4. projectstorm/react-diagrams
**Possible, but not the leading choice**

Strengths:
- React-based and extensible
- Process-oriented diagram library

Weaknesses:
- Mindshare and ecosystem look weaker than React Flow
- Less obvious fit for current product direction

## Recommendation

### Primary recommendation
Use **React Flow (`@xyflow/react`)** for the graph editor UI.

### Why
Because this problem has two layers:
1. **Graph editing UI**
2. **Workflow execution engine**

React Flow is the better choice for layer 1 in this codebase.
We should build layer 2 ourselves because CoNAI has special module semantics:
- NAI modules
- ComfyUI modules
- typed image/text/number/object ports
- cross-engine execution
- module templates with editable regions
- future validation/execution planning

## What the system actually needs

### 1. Module definition schema
We need a generic module definition model, for example:
- `id`
- `name`
- `engineType` (`nai`, `comfyui`, later others)
- `category`
- `inputs[]`
- `outputs[]`
- `configSchema`
- `editableFields`
- `templatePayload`
- `version`

A port needs at least:
- `key`
- `label`
- `dataType` (`image`, `mask`, `prompt`, `text`, `number`, `boolean`, `json`, etc.)
- `required`
- `multiple`

### 2. Graph workflow schema
We need a graph document independent from ComfyUI raw JSON:
- `nodes[]`
- `edges[]`
- `viewport`
- `workflow metadata`

Each node instance should store:
- `moduleId`
- `position`
- `inputValues`
- `resolvedConfig`

Each edge should store:
- `sourceNodeId`
- `sourcePortKey`
- `targetNodeId`
- `targetPortKey`

### 3. Type system and connection rules
Need validation rules like:
- `image -> image` allowed
- `text -> image` not allowed
- `prompt -> prompt` allowed
- `image -> mask` maybe blocked unless explicitly convertible

This must exist in both frontend validation and backend validation.

### 4. Execution planner
The backend needs a generic planner that:
- topologically sorts the graph
- resolves upstream outputs
- executes nodes in order
- persists intermediate artifacts
- supports engine bridges

Examples:
- NAI output image saved as runtime artifact
- downstream ComfyUI img2img node receives that artifact as image input
- downstream NAI infill node receives image + mask artifact

### 5. Artifact store
We need durable runtime artifacts for graph execution:
- images
- masks
- text blobs
- JSON payloads

Each artifact should have:
- `artifactId`
- `type`
- `path or blob ref`
- `metadata`
- `createdBy execution step`

### 6. Module authoring UI
When creating a module, authors must be able to define:
- editable fields
- exposed input ports
- exposed output ports
- mappings from ports to engine payload fields

For ComfyUI modules:
- wrap a Comfy workflow/template
- expose selected node inputs as module inputs
- expose selected output node images/text as module outputs

For NAI modules:
- wrap generation request templates
- expose prompt/model/seed/image/mask/etc.
- expose output image and metadata

## Important design warning
Do **not** model the new system as "ComfyUI workflow plus some extra NAI fields".
That would trap the architecture.

The correct abstraction is:
- **generic module graph system**
- where ComfyUI and NAI are both execution backends

## Suggested implementation order

### Phase 0 — research spike
- add graph editor library
- build a fake local-only prototype with 3 node types:
  - text prompt node
  - NAI generate node
  - ComfyUI img2img node
- verify custom ports, edge validation, node inspector, serialization

### Phase 1 — data model
- add DB tables for:
  - module_definitions
  - graph_workflows
  - graph_workflow_versions
  - graph_executions
  - graph_execution_artifacts

### Phase 2 — frontend editor
- graph canvas page
- node palette
- inspector panel
- save/load graph
- connection validation

### Phase 3 — backend executor
- graph validation
- topological execution
- artifact persistence
- NAI executor adapter
- ComfyUI executor adapter

### Phase 4 — module authoring
- create module from NAI template
- create module from ComfyUI workflow template
- expose editable inputs/outputs

## Recommended first technical choice
Install and prototype with:
- `@xyflow/react`

Possible supporting libraries later:
- `dagre` or `elkjs` for auto-layout
- `zod` for module schema and validation

## Decision snapshot
If we start now, the safest path is:
1. Choose `@xyflow/react`
2. Design our own generic module/port/edge schema
3. Build a thin prototype editor before changing existing generation storage models

## Additional review — module authoring rules from current product requirements

### NAI module authoring should be snapshot-based
For NAI, module creation should start from the **current image-generation page state**.

That means a NAI module is not authored from scratch first.
Instead, the author:
1. configures NAI on the generation page
2. clicks something like `Create Module from Current Settings`
3. chooses which fields are:
   - fixed inside the module
   - exposed as editable module inputs
   - optionally hidden but still stored as defaults

So a NAI module definition should store:
- a full frozen default payload snapshot
- a list of exposed editable inputs
- metadata for labels, types, defaults, validation, and UI hints

Example:
- Current NAI page state may include model, sampler, steps, scale, resolution, ucPreset, variety+, action, strength, noise
- The module author may expose only:
  - prompt
  - negative_prompt
  - seed
- while everything else stays fixed in the module template

This is important because it means:
- the NAI generation page doubles as a **module authoring source**
- the system needs a clean conversion path from `current form state` -> `module definition`

### ComfyUI module authoring can reuse much of the existing workflow system
Current ComfyUI workflow handling already has a partial simplification system:
- raw workflow JSON is stored
- selected editable inputs are defined in `marked_fields`

This is very close to module authoring already.
So for V1, ComfyUI modules can likely be created by wrapping the existing workflow record.

However, the existing model is not fully sufficient yet.
We still need to add explicit concepts for:
- module input ports
- module output ports
- port data types
- output exposure selection
- graph-connection rules

In other words:
- `marked_fields` can likely be reused as the **starting point for module inputs**
- but `marked_fields` alone are not enough to define a full graph module

### Practical implication for ComfyUI migration
A good V1 migration path is:
1. keep existing ComfyUI workflow records
2. add a conversion/wrapping layer that turns them into module definitions
3. map each `marked_field` into a candidate module input
4. add explicit output declarations separately

For example, a ComfyUI module may need outputs like:
- generated image
- mask image
- latent
- text metadata

The current workflow system does not model those explicitly.
That must be added.

### Recommended module-definition split
The module system should clearly separate these concepts:

- `templateDefaults`
  - the full stored engine payload/template
- `exposedInputs`
  - user-editable values when the module is used in a graph
- `internalFixedValues`
  - values frozen by the module author
- `outputPorts`
  - outputs that downstream nodes can connect to

This split is especially important because NAI and ComfyUI arrive from different authoring directions:
- NAI: **form snapshot first**
- ComfyUI: **workflow template first**

### Architectural conclusion from the new requirement
The module authoring UX should not be identical for NAI and ComfyUI.

Instead:
- NAI authoring should be **state capture -> expose selected fields**
- ComfyUI authoring should be **workflow wrap/simplify -> expose selected fields and outputs**

But after authoring, both should compile into the same generic `module_definition` shape.

That gives us:
- different authoring UX per engine
- one common runtime graph system
