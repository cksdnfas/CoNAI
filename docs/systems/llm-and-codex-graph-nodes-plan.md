# LLM and Codex Graph Nodes Plan

_Date: 2026-04-24_

## Goal

Add first-class graph nodes that can:
- call local or remote LLM providers
- support LM Studio
- support Ollama
- support external OpenAI-compatible APIs
- send a message to Codex and receive a text response

This should fit CoNAI's current module-graph architecture instead of creating a separate side workflow.

## Product Intent

The workflow canvas should be able to use LLMs as ordinary building blocks.
A user should be able to:
- generate or transform text inside a workflow
- summarize metadata or prompts before image generation
- branch on structured JSON returned by an LLM
- call a local LLM runtime such as LM Studio or Ollama
- call a remote OpenAI-compatible endpoint
- send a one-shot instruction to Codex and consume the reply downstream

This is not just an API integration task.
It is a graph-node design task.
The node UX, provider configuration model, and execution contract must all match the current module-graph direction.

## Current Architectural Baseline

As of this document:
- CoNAI already supports first-class graph modules for `nai`, `codex`, `comfyui`, `system`, and `custom_js`
- the graph executor dispatches by `engine_type`
- system-native operations are registered through stable `operation_key` values
- Codex already exists as an image-generation path, including reusable snapshot modules and queue-backed execution
- the module-graph UX is actively shifting toward canvas-first inline editing, with shared inline field renderers and reduced dependence on the inspector
- CoNAI already has an encrypted external-provider store in `external_api_providers`

Important consequence:
- Codex image generation already exists
- Codex message/chat execution does **not** yet exist as a first-class graph node
- LLM provider configuration should reuse or extend the existing provider-credential store instead of inventing another credential silo

## Scope

### In scope for v1
- provider-backed text-generation / text-transformation graph nodes
- LM Studio support
- Ollama support
- external OpenAI-compatible API support
- one-shot Codex message node
- text, JSON, and metadata outputs
- provider selection and basic runtime settings on the graph node
- provider credentials and base URLs stored outside workflow JSON

### Explicitly out of scope for v1
- multi-turn persistent chat sessions
- tool-calling inside the LLM node
- streaming token UI on the graph canvas
- multi-image multimodal prompting
- agentic subtask orchestration from inside one graph node
- provider-specific advanced options beyond a small normalized set

Those can follow once the basic execution contract is proven.

## Node Inventory Recommendation

### 1. `system.call_llm`
A provider-neutral text-generation node.

#### Inputs
- `prompt` (`text` or `prompt`, required)
- `system_prompt` (`text`, optional)
- `context` (`text`, optional)
- `provider_connection` (`text` or `select`, required)
- `model` (`text` or `select`, optional)
- `temperature` (`number`, optional)
- `max_tokens` (`number`, optional)
- `response_mode` (`select`, optional: `text` | `json`)

#### Outputs
- `text` (`text`)
- `json` (`json`)
- `metadata` (`json`)

#### Notes
- This node should work with LM Studio, Ollama, and external OpenAI-compatible APIs through one normalized adapter layer.
- v1 should prefer one-shot request/response semantics.

### 2. `system.call_codex_message`
A Codex-specific one-shot message node.

#### Inputs
- `prompt` (`text`, required)
- `system_prompt` (`text`, optional)
- `context` (`text`, optional)
- `model` (`text`, optional)
- `output_mode` (`select`, optional: `text` | `json`)

#### Outputs
- `text` (`text`)
- `json` (`json`)
- `metadata` (`json`)

#### Notes
- This node is intentionally separate from the existing Codex image-generation path.
- It should not be forced through the image-generation queue contract if the task is purely textual.
- v1 should be stateless and one-shot.

## UX Rules

The current module-graph direction matters here.
These nodes should be designed for the new canvas-first workflow.

### Inline-on-node fields
These fields should be editable directly on the node card whenever possible:
- provider connection
- model
- temperature
- max tokens
- response mode

### Inspector/modal fields
These should remain in the inspector or a larger edit surface:
- long prompt bodies
- long system prompts
- large JSON schema or raw provider options
- debugging details and raw response dumps

### Why this matters
The node UX redesign is moving away from inspector-first editing.
New LLM nodes should be built for that future state immediately instead of inheriting an older UX pattern.

## Provider Model Recommendation

## Reuse the existing provider store
CoNAI already has `external_api_providers` with encrypted API-key storage.
That should become the source of truth for LLM provider connections.

### Recommended provider categories
- `general`
- `llm_openai_compatible`
- `llm_ollama`

### Practical mapping
- **LM Studio** → `llm_openai_compatible`
- **external OpenAI-compatible API** → `llm_openai_compatible`
- **Ollama** → `llm_ollama`

### Why not invent a second settings silo
Because the project already solved:
- encrypted key storage
- base URL persistence
- enable/disable state
- admin routes for provider management

Reuse is cheaper, clearer, and less fragile.

## Execution Architecture

## 1. Provider-neutral LLM execution service
Add a backend service layer that normalizes LLM requests.

Recommended shape:
- `executeLlmTextRequest(...)`
- adapter selection by provider type
- shared normalized request shape
- shared normalized response shape

### Normalized request
- provider connection id or provider name
- prompt
- system prompt
- context
- model
- temperature
- max tokens
- response mode

### Normalized response
- text
- parsed JSON when requested and valid
- model name
- provider name
- timing / token metadata when available
- raw response summary for debugging

## 2. Provider adapters
Add adapter functions for:
- OpenAI-compatible chat/responses endpoint
- Ollama generation/chat endpoint
- Codex message execution

### OpenAI-compatible adapter
Used for:
- LM Studio
- external OpenAI-compatible APIs
- any future self-hosted OpenAI-compatible endpoint

### Ollama adapter
Use Ollama's native HTTP endpoints.
Do not force Ollama through fake OpenAI compatibility if the native path is simpler and more stable.

### Codex adapter
Codex should remain separate.
It already has project-specific runtime conventions and should not be hidden behind the generic provider abstraction too early.

## 3. Graph execution integration
The first implementation should use `system` built-in nodes with stable `operation_key` values:
- `system.call_llm`
- `system.call_codex_message`

Why this is the right first step:
- lowest-risk integration into the current graph engine
- easy to expose in the module library
- easy to tune the node contract before introducing reusable saved LLM modules

## Phase Plan

## Phase 1 — foundation
- document the node plan
- extend provider typing to support LLM-specific provider kinds
- add connection-test support for OpenAI-compatible endpoints and Ollama
- keep credentials outside workflow JSON

## Phase 2 — runtime execution
- add provider-neutral LLM execution service
- add OpenAI-compatible adapter
- add Ollama adapter
- add Codex message adapter
- normalize text/JSON/metadata outputs

## Phase 3 — graph node integration
- register built-in system modules for `system.call_llm` and `system.call_codex_message`
- add node UX metadata for inline controls
- wire the executor to the new system operation handlers

## Phase 4 — UX refinement
- expose inline provider/model controls on the node card
- keep large prompt editing in the inspector/modal path
- add provider-specific availability/status hints where useful

## Phase 5 — reusable modules
- optionally allow saved reusable LLM modules after the runtime contract is stable
- add module presets for common provider/model combinations

## Risks

### 1. Provider fragmentation
OpenAI-compatible providers look similar but are not identical.
LM Studio, self-hosted gateways, and commercial APIs may differ in:
- endpoint paths
- auth requirements
- response shapes
- supported parameters

### 2. Ollama contract drift
Ollama is better treated as its own adapter.
Trying to squeeze it into a pure OpenAI-compatible path can create avoidable bugs.

### 3. UX mismatch risk
If the node is implemented inspector-first, it will already be out of step with the current node UX redesign.

### 4. Secret leakage risk
Provider keys must never be stored in workflow JSON, execution logs, or node exports.

### 5. Scope creep
If v1 tries to include multi-turn memory, tools, multimodal inputs, schema enforcement, and streaming at once, delivery will slow down badly.

## Recommended v1 Rule

If one implementation rule should remain fixed, it is this:

> Build LLM and Codex message capability first as canvas-friendly `system` graph nodes backed by a shared provider registry, with LM Studio and external OpenAI-compatible APIs sharing one adapter family and Ollama using its own adapter.

That keeps the first release consistent with CoNAI's existing graph engine, current node UX direction, and provider-storage model.
