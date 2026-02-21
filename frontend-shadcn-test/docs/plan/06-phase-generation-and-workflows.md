# Phase 06: Generation and Workflows

## Objective

Migrate all creation pipelines (ComfyUI/NAI/Wildcard/Workflow) with run-time reliability.

## In Scope

- Image generation page domains:
  - `frontend/src/pages/ImageGeneration/*`
  - tabs: ComfyUI, Chain, Wildcard, NAI, Servers
  - generation history and repeat execution
- Workflow pages:
  - `frontend/src/pages/Workflows/WorkflowFormPage.tsx`
  - `frontend/src/pages/Workflows/WorkflowGeneratePage.tsx`
  - graph viewers, marked fields, node components, repeat status
- Prompt explorer and wildcard management features:
  - `frontend/src/features/PromptExplorer/*`
  - `frontend/src/components/Wildcard*`

## Out of Scope

- Full settings migration (Phase 07).

## Work Breakdown

1. Port tab container and per-tab API/state hooks.
2. Port generation history and retry/repeat mechanics.
3. Port workflow graph/form/generate flows and server state interactions.
4. Port wildcard and prompt grouping UIs with CRUD operations.

## Commit Checkpoints

- `feat(shadcn-phase-06): migrate image generation tab container and shared state`
- `feat(shadcn-phase-06): migrate NAI and ComfyUI generation flows`
- `feat(shadcn-phase-06): migrate workflow form and graph viewer`
- `feat(shadcn-phase-06): migrate wildcard and prompt explorer management`
- `test(shadcn-phase-06): add tests for workflow parsing and repeat execution logic`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Domain tests for workflow parser/prompt builder/repeat execution

Manual:

- End-to-end generation run for ComfyUI and NAI.
- Workflow create/edit/generate including marked fields.
- Wildcard create/edit/delete and prompt grouping correctness.

## Exit Criteria

- Core generation pipelines are stable and parity-complete.
- Workflow editing/generation is fully usable without fallback to legacy frontend.

