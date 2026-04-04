# Workflow Media Preview Reuse Plan

## Background

The CoNAI frontend already uses shared media rendering for list-oriented image cards and detail views because the system handles mixed visual media:

- static images
- GIF images
- videos

However, the workflow-facing UI still renders many single-media previews with direct `<img>` tags and repeated Tailwind class strings. This creates avoidable drift in behavior, styling, and future maintenance.

## Problem Statement

The following workflow-oriented surfaces still use fragmented preview rendering patterns:

- form input previews
- workflow runner previews
- execution result previews
- selection summary cards
- node-level artifact previews

Current issues:

1. media rendering logic is duplicated across files
2. styling is repeated instead of centralized
3. many previews assume `image/*` only
4. workflow surfaces do not consistently reuse the existing shared media layer
5. future support for mixed media becomes harder to maintain

## Goals

1. Reuse the existing shared media rendering approach wherever practical
2. Centralize single-preview styling for workflow-related panels
3. Improve compatibility with image / GIF / video previews
4. Reduce direct `<img>` usage in workflow surfaces
5. Make future maintenance easier by introducing one reusable preview primitive

## Non-Goals

This plan does **not** aim to:

- redesign the visual language of all cards
- replace the existing list-cell system (`ImageListItem`) everywhere
- rework the entire image attachment flow in one pass
- change backend artifact storage contracts in this phase

## Proposed Design

### 1. Introduce one shared workflow-safe media preview component

Create a reusable preview surface that:

- accepts a resolved media URL or data URL
- accepts optional mime metadata
- reuses the existing shared media rendering layer for image / GIF / video handling
- centralizes the repeated bordered preview frame style
- supports compact and panel-sized preview usage

This component should be lightweight and reusable in forms, execution panels, and picker summaries.

### 2. Preserve the current reusable card model

Do **not** force `ImageListItem` into workflow forms and execution panels.

Reason:
- `ImageListItem` is optimized for list/grid behavior
- it includes selection, activation, overlay, and quick-action concerns
- workflow forms need a smaller primitive, not the full list card

Instead, reuse the lower media-rendering layer and add a smaller shared preview primitive for single-media surfaces.

### 3. Strengthen the selected media draft model

Where practical, enrich workflow-side temporary media draft data with optional mime information so previews can classify image / GIF / video more reliably.

## Phase Breakdown

### Phase 1 — Foundation + High-Value Workflow Reuse

Deliverables:

- add a reusable single-media preview component
- add optional mime support to workflow-side selected media draft data
- replace direct `<img>` previews in the main workflow surfaces

Primary target files:

- `frontend/src/features/image-generation/components/workflow-field-input.tsx`
- `frontend/src/features/module-graph/components/workflow-runner-panel.tsx`
- `frontend/src/features/module-graph/components/node-inspector-panel.tsx`
- `frontend/src/features/module-graph/components/workflow-exposed-input-editor.tsx`
- `frontend/src/features/module-graph/components/execution-artifact-card.tsx`
- `frontend/src/features/module-graph/components/graph-execution-panel.tsx`
- `frontend/src/features/module-graph/components/module-graph-node-card.tsx`
- `frontend/src/features/image-generation/components/image-attachment-picker.tsx`

Success criteria:

- workflow surfaces stop duplicating the same preview frame markup
- new preview component is used in the major workflow result/form surfaces
- frontend builds successfully

### Phase 2 — Broader Cleanup

Possible follow-up targets:

- reusable asset pickers
- additional generation-side selected media cards
- small preview surfaces in settings or related utility panels

Success criteria:

- fewer remaining direct `<img>` previews in media-aware UI paths
- more consistent preview behavior across features

## Verification Strategy

1. Type-check and build the frontend
2. Verify workflow input preview rendering still works
3. Verify runner/result preview rendering still works
4. Verify execution artifact preview rendering still works
5. Verify selection summary cards still render correctly
6. Spot-check that preview layout remains visually consistent

## Implementation Notes

- Keep changes surgical and avoid unrelated visual cleanup
- Prefer adapting existing data into the shared preview component over inventing parallel rendering paths
- Preserve current page behavior unless the change directly improves reuse or consistency
- If a source can only provide image-like URLs in this phase, structure the component so richer media metadata can be added later without churn

## Expected Outcome

After Phase 1, workflow-oriented single-media previews should share one rendering primitive, reduce duplicated styling, and align better with the system-wide mixed-media design direction.
