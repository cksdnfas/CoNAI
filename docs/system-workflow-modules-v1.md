# System Workflow Modules v1

## Goal
Define the first batch of **system-native workflow modules** for the graph editor so existing CoNAI features can be reused as nodes.

This document is about modules that are **not just NAI form snapshots** and **not just ComfyUI workflow wrappers**.
These modules expose internal CoNAI capabilities such as tag extraction, artist extraction, image lookup, prompt lookup, and prompt-group sampling.

---

## Why this exists
The current graph system already supports reusable module definitions and typed ports, but the first visible modules are still mostly engine-centric.

The next step is to let users build workflows from **CoNAI-native operations**, for example:
- input image -> extract tags
- input image -> extract artist/style hints
- input image -> find similar images
- similar-image reference -> load image
- similar-image reference -> load prompt
- prompt group -> random prompt

That is the difference between a graph UI and an actually useful product workflow system.

---

## Current architectural gap
Current `ModuleEngineType` is:
- `nai`
- `comfyui`

Current executor only dispatches:
- `executeNaiModule(...)`
- `executeComfyModule(...)`

That means a true CoNAI-native module does **not** fit cleanly yet.

## Required decision
For system-native modules, add a third engine type:
- `system`

Recommended model:
- `engine_type`: `system`
- `authoring_source`: `manual`

### Why not fake these as `nai` modules?
Because these nodes are not image-generation requests. They are product operations:
- metadata lookup
- image analysis
- prompt retrieval
- library search
- prompt sampling

If they are forced into `nai`, execution logic and validation will become misleading.

### Why not fake these as `comfyui` modules?
Same problem. These operations do not map to a Comfy graph execution backend.

### Decision
**System-native workflow nodes should be first-class modules with `engine_type = system`.**

---

## v1 rules

### 1. Reuse existing port types
Do **not** add many new port data types in v1.
Use the existing types:
- `image`
- `mask`
- `prompt`
- `text`
- `number`
- `boolean`
- `json`

### 2. Use `json` for structured references
Whenever a module returns a list, search result, or structured object, output `json`.

This keeps v1 simple and avoids prematurely adding custom data types like:
- `image_ref`
- `hash_list`
- `prompt_bundle`

Those can be introduced later if needed.

### 3. Gate modules by capability/settings
A system-native module may depend on a feature that can be disabled.

Examples:
- automatic tag extraction disabled
- artist extraction disabled
- similar image search unavailable
- prompt groups unavailable

The module catalog should therefore support **availability state**.

Recommended behavior:
- if the capability is impossible or unconfigured, hide the module or show it as disabled
- if a saved graph contains the module but the capability is now unavailable, execution should fail with a clear message

### 4. Keep outputs narrow
One module should return the smallest useful result.
Do not overload one node with many unrelated outputs in v1.

Example:
- `Find Similar Images` returns a `json` result list
- a separate loader node resolves one selected result into an `image`
- another separate loader node resolves one selected result into a `prompt`

That keeps graph composition explicit and debuggable.

---

## Proposed v1 module catalog

### Category: Analysis

## 1. Extract Tags From Image
**Purpose**
Turn one input image into extracted tag text that downstream prompt nodes can consume.

**Availability dependency**
- automatic tag extraction feature must be enabled and callable in the current system

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `analysis`

**Inputs**
- `image` (`image`, required)
- `joiner` (`text`, optional, default: `", "`)
- `max_tags` (`number`, optional)

**Outputs**
- `tags_text` (`text`)
- `tags_prompt` (`prompt`)
- `tags_json` (`json`)

**Execution behavior**
- run the existing tag extraction path on the input image
- normalize the result into:
  - plain text output
  - prompt-friendly output
  - structured JSON output

**Notes**
- `tags_text` and `tags_prompt` may be identical in v1
- `tags_json` should preserve score/rank metadata if available

---

## 2. Extract Artist From Image
**Purpose**
Infer artist/style hints from an input image and return text that can be reused in prompts.

**Availability dependency**
- artist extraction or equivalent style-inference capability must be enabled

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `analysis`

**Inputs**
- `image` (`image`, required)
- `include_style_hints` (`boolean`, optional, default: `true`)

**Outputs**
- `artist_text` (`text`)
- `artist_prompt` (`prompt`)
- `artist_json` (`json`)

**Execution behavior**
- run the existing artist/style extraction path
- emit both simple text and structured JSON

**Notes**
- if the backend returns multiple candidates, keep them in `artist_json`
- `artist_text` can be the best candidate or a normalized comma-separated string

---

### Category: Retrieval

## 3. Find Similar Images
**Purpose**
Search the library for images similar to the input image.

**Availability dependency**
- similar image search/hash search must be available

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `retrieval`

**Inputs**
- `image` (`image`, required)
- `limit` (`number`, optional, default: `12`)
- `include_prompt` (`boolean`, optional, default: `true`)

**Outputs**
- `matches` (`json`)

**Execution behavior**
- compute or resolve the input image hash/signature as needed
- query similar-image search
- emit ordered structured results

**Suggested JSON shape**
```json
{
  "items": [
    {
      "rank": 1,
      "composite_hash": "...",
      "score": 0.92,
      "image_id": 123,
      "file_path": "...",
      "prompt": "..."
    }
  ]
}
```

**Notes**
- v1 should treat this as a pure `json` output
- downstream nodes decide how to consume the list

---

## 4. Load Image From Reference
**Purpose**
Resolve a reference value into an actual image output.

This is the bridge that makes retrieval results composable.

**Availability dependency**
- local image library lookup must be available

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `retrieval`

**Inputs**
- `reference` (`json`, required) or `composite_hash` (`text`, required in alternate form)
- `selection_mode` (`select`, optional, UI-only: `first`, `best`, `index`, `random`)
- `index` (`number`, optional)

**Outputs**
- `image` (`image`)
- `image_ref` (`json`)

**Execution behavior**
- accept either:
  - a result list JSON from `Find Similar Images`
  - a direct hash string
- select a record
- load the actual image content as the output image
- also emit a normalized JSON reference for downstream metadata/prompt loaders

**Suggested normalized `image_ref` JSON**
```json
{
  "composite_hash": "...",
  "image_id": 123,
  "file_path": "..."
}
```

---

## 5. Load Prompt From Reference
**Purpose**
Resolve an image reference into prompt text or prompt metadata.

**Availability dependency**
- image metadata lookup must be available

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `retrieval`

**Inputs**
- `reference` (`json`, required) or `composite_hash` (`text`, required in alternate form)
- `field` (`text`, optional, default: `prompt`)

**Outputs**
- `prompt` (`prompt`)
- `text` (`text`)
- `metadata` (`json`)

**Execution behavior**
- resolve the image record
- load prompt-related metadata from the library
- emit prompt-ready text and full structured metadata

**Notes**
- `field` may later support `positive`, `negative`, `original_prompt`, etc.
- v1 can just return the main prompt string and the full metadata blob

---

### Category: Prompt Source

## 6. Random Prompt From Group
**Purpose**
Sample one prompt from a stored prompt group.

**Availability dependency**
- prompt group feature must be available

**Module shape**
- `engine_type`: `system`
- `authoring_source`: `manual`
- `category`: `prompt-source`

**Inputs**
- `group_id` (`number`, optional)
- `group_name` (`text`, optional)
- `seed` (`number`, optional)
- `mode` (`text`, optional, default: `random`)

**Outputs**
- `prompt` (`prompt`)
- `text` (`text`)
- `entry_json` (`json`)

**Execution behavior**
- resolve the target prompt group by id or name
- sample one entry
- return prompt text and full entry metadata

**Notes**
- if both `group_id` and `group_name` are provided, `group_id` wins
- `seed` should make selection reproducible later if deterministic sampling is implemented

---

## Optional near-v1 modules
These are useful, but they are not required for the first system-native milestone.

### A. Load Metadata From Image
- input: `image`
- outputs: `json`, maybe `prompt`
- useful for image ingestion or library-linked images

### B. Pick Item From JSON List
- input: `json`
- outputs: `json`
- utility node for selecting one result from a list using `index`, `random`, `best`, etc.

### C. Merge Prompt Text
- inputs: multiple `prompt`/`text`
- output: `prompt`
- useful as a system-side prompt composer

### D. Read Prompt Group By Rule
- input: group + filter rule
- output: `json` or `prompt`
- useful later for smarter sampling

---

## Catalog/UI behavior

### Module library behavior
System-native modules should appear in the module library like other modules, but with:
- category grouping
- capability-aware disabled state
- clear human descriptions

Recommended categories:
- `analysis`
- `retrieval`
- `prompt-source`
- later: `utility`

### Disabled module behavior
If a capability is off or unavailable:
- show disabled state with a reason, or hide from creation UI
- do not silently allow execution to fail later

Suggested disabled reasons:
- `Auto tag extraction is disabled`
- `Artist extraction is unavailable`
- `Similar image search is not configured`
- `Prompt groups are unavailable`

---

## Execution contract for `system` modules
A `system` module should execute through a dedicated executor path:
- `executeSystemModule(...)`

That executor should dispatch by a stable module operation key stored in `template_defaults` or `internal_fixed_values`.

Suggested internal operation key examples:
- `system.extract_tags_from_image`
- `system.extract_artist_from_image`
- `system.find_similar_images`
- `system.load_image_from_reference`
- `system.load_prompt_from_reference`
- `system.random_prompt_from_group`

### Recommended execution model
Each system module definition stores:
- a stable operation key
- static configuration
- typed input/output port declarations

At runtime:
1. resolve inputs like any other graph node
2. dispatch to system executor by operation key
3. return typed artifacts just like any other module

---

## Validation rules

### Graph validation
Existing graph validation rules should still apply:
- only connect same-type ports
- required inputs must resolve before execution

### Additional validation for system modules
System modules need capability validation before execution:
- module operation exists
- required backing feature is enabled
- referenced record/group exists

This should fail with a clear user-facing message.

---

## Recommended data shape strategy

### Rule
Use `json` as the interchange format for references and result lists in v1.

### Why
Because it keeps the schema small while still supporting:
- image search results
- image references
- prompt metadata blobs
- ranked candidate lists

### Tradeoff
This is less strict than introducing new data types like `image_ref`.
That is acceptable in v1 because it keeps implementation velocity high.

---

## Implementation order

### Phase 1 — schema/runtime support
1. add `system` to `ModuleEngineType`
2. add `executeSystemModule(...)` path to the graph executor
3. add capability checks for system-native modules
4. define stable operation keys

### Phase 2 — first module definitions
Seed built-in module definitions for:
1. `Extract Tags From Image`
2. `Extract Artist From Image`
3. `Find Similar Images`
4. `Load Image From Reference`
5. `Load Prompt From Reference`
6. `Random Prompt From Group`

### Phase 3 — module library UX
1. category sections
2. disabled-state messaging
3. better descriptions and examples

### Phase 4 — utility follow-ups
1. `Pick Item From JSON List`
2. `Merge Prompt Text`
3. `Load Metadata From Image`

---

## Non-goals for v1
- no new custom port data types beyond current schema
- no generic AI tool-node framework
- no dynamic multi-output schema per run
- no hidden automatic edge creation
- no large utility-node explosion

---

## Decision summary
For the next workflow milestone, CoNAI should introduce **system-native modules** as first-class graph modules.

The main design choices are:
- add `engine_type = system`
- keep `authoring_source = manual`
- reuse existing port data types
- use `json` for structured references/results
- gate modules by current capability/settings
- start with a small high-value module set

This gives the graph editor real product value without overcomplicating the schema too early.
