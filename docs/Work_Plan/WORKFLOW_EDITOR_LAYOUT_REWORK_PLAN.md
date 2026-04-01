# Workflow Editor Layout Rework Plan

## Scope

Target surface:

- `generation?tab=workflows`
- specifically the workflow creation / workflow editor experience inside the module-graph page

This document captures the requested structural UI rework for later implementation.

## Requested Changes

### 1) Global floating sidebar behavior needs a manual lock / restore action

Current behavior:

- the shared explorer-style sidebar can visually enter a floating state while scrolling
- this floating treatment is currently the default visual behavior for sticky sidebars

Requested behavior:

- when the sidebar is in floating mode, a separate action should appear near the bottom of the viewport
- that action should return the sidebar to its original anchored position
- the action should also lock the sidebar so it no longer follows the scroll in floating mode

In short:

- floating should remain available,
- but users need an explicit way to restore and pin the sidebar back to its original layout position.

### 2) The panels currently listed below the graph canvas should move into a bottom-rising overlay

Current editor layout stacks the following sections below the graph canvas:

- workflow setup
- node inspector
- exposed input editor
- workflow validation
- execution panel

Requested behavior:

- these sections should no longer remain permanently stacked under the graph canvas
- they should move into a modal / popup / drawer style surface that rises from the bottom
- the graph canvas should remain the main visual focus
- the overlay approach must work in both 1-column and 2-column layouts

Reason:

- when the graph is present, having large panels below it makes wheel/scroll interaction awkward
- the lower content should be brought forward as an overlay instead of extending the page downward

## Current Relevant Implementation

### Workflow editor page

Current workflow editor structure is in:

- `frontend/src/features/module-graph/module-graph-page.tsx`

In edit mode, the page currently renders:

- left workflow list sidebar
- graph canvas card
- then multiple cards/panels below the canvas

That lower stack is the main target of the requested rework.

### Shared sidebar shell already exists

Reusable sidebar component:

- `frontend/src/components/common/explorer-sidebar.tsx`

Related styling:

- `frontend/src/index.css`
- `.explorer-sidebar-floating-frame`
- `.explorer-sidebar[data-floating='true'] ...`

Important existing behavior:

- `ExplorerSidebar` already detects whether a sticky sidebar has reached its floating visual state
- it currently exposes that state only through styling (`data-floating='true'`)
- it does not yet support a user-controlled pin / lock override

### Shared bottom overlay pattern already exists

Reusable bottom-rising sheet:

- `frontend/src/components/ui/bottom-drawer-sheet.tsx`

Reusable floating trigger button:

- `frontend/src/components/ui/floating-bottom-action.tsx`

This is important because the requested workflow-editor rework should reuse the existing shared overlay style instead of inventing a new one-off panel system.

## Core Direction

### A. Do not invent a new custom sidebar pattern

The sidebar change should extend the shared `ExplorerSidebar` behavior.

That means:

- keep one shared sidebar shell
- add a shared capability for user-controlled lock / restore behavior
- avoid page-specific imitation logic if the intent is truly global sidebar behavior

### B. Do not keep the editor detail panels permanently below the graph

The graph editor should become a graph-first surface.

That means:

- keep the graph canvas visible and dominant
- move supporting editor panels into an overlay that can be opened on demand
- use the existing bottom-drawer interaction model as the baseline unless a stronger reason appears later

## Recommended UX Structure

## 1. Sidebar floating lock / restore behavior

### User-facing behavior

When the sidebar is floating:

- show a bottom floating action button such as:
  - `Lock Sidebar`
  - or a shorter icon+label action
- activating it should:
  - restore the sidebar from floating state to its original anchored layout position
  - prevent it from re-entering the floating-follow behavior until unlocked again

When locked:

- show a clear unlocked/locked affordance in or near the sidebar header, or reuse the same bottom action area to allow unlocking
- the state should be understandable without technical explanation

### Recommended behavior details

- lock state should override the automatic floating visual treatment
- if the page is scrolled far enough that the sidebar would normally float, locking should instead keep the sidebar treated as anchored
- restoring should feel immediate and visually stable

### State strategy

This should be evaluated as either:

- a local page/session UI state,
- or a shared persistent UI preference for explorer-style sidebars

Recommended first step:

- implement as local UI state for the affected workflow surface first,
- then generalize into shared behavior if it proves useful elsewhere.

That avoids overcommitting to a global persistence model too early.

## 2. Bottom overlay for editor support panels

### User-facing behavior

In workflow edit mode:

- the graph canvas remains the main visible workspace
- the lower editor panels are removed from the permanent page flow
- a bottom action opens an overlay containing the editing/support tools

This should apply in both:

- 1-column layout
- 2-column layout

### Panels to move into the overlay

Initial target set:

- Workflow Setup
- Node Inspector
- Workflow Exposed Input Editor
- Workflow Validation Panel
- Graph Execution Panel

### Overlay interaction model

Recommended baseline:

- use `BottomDrawerSheet`
- open from a `FloatingBottomAction`
- keep graph canvas visible behind the overlay
- allow scroll inside the overlay rather than on the whole page

### Overlay organization

A single long drawer may still become too heavy, so the overlay should likely use internal sections or tabs.

Recommended organization:

- top-level segmented navigation or tabs inside the drawer
- example sections:
  - `Setup`
  - `Inspector`
  - `Inputs`
  - `Validation`
  - `Results`

Alternative:

- keep one vertical scroll surface initially
- if it feels too dense, split into tabs later

Recommended first implementation:

- start with one drawer and lightweight section jump controls
- do not overengineer tabs unless the content density clearly requires them

## Layout Guidance

### Wide layout (2-column)

Current wide layout includes:

- left workflow sidebar
- right editor area

Requested direction:

- keep the left workflow sidebar
- keep the graph canvas in the right editor area
- remove the long stack below the graph from the normal flow
- expose the moved panels via bottom overlay

### Narrow layout (1-column)

Requested direction:

- same conceptual model as wide layout
- graph canvas remains primary
- support panels open in the same bottom overlay pattern
- avoid a different editing concept between 1-column and 2-column modes

This consistency matters because the user explicitly requested that the change apply regardless of 1-column or 2-column layout.

## Shared Components / Styles To Reuse

The rework should reuse the existing shared UI system where possible.

### Sidebar

Reuse / extend:

- `ExplorerSidebar`

Potential enhancements:

- controlled floating lock state
- optional bottom floating action exposure when `data-floating='true'`
- optional header action for lock/unlock status

### Bottom overlay

Reuse:

- `BottomDrawerSheet`
- `FloatingBottomAction`

Related theme tokens/classes already available:

- `theme-floating-panel`
- `theme-drawer-header`
- `theme-drawer-body`
- `theme-bottom-drawer`

This means the requested behavior already has a matching shared style foundation.

## Implementation Strategy

### Phase 0 — Documentation only

- keep this plan as the implementation reference
- no code changes yet while current DB work remains active

### Phase 1 — Sidebar lock behavior

Goal:

- support restoring/locking the floating sidebar behavior without touching the workflow editor layout yet

Suggested work:

1. extend `ExplorerSidebar` or wrap it with a shared optional lock capability
2. expose whether floating is active and whether lock is enabled
3. add a bottom floating action when the sidebar is floating
4. ensure lock disables floating-frame behavior and restores anchored treatment

Potential touchpoints:

- `frontend/src/components/common/explorer-sidebar.tsx`
- `frontend/src/index.css`
- possibly the workflow sidebar caller (`saved-graph-list.tsx`) depending on how the API is designed

### Phase 2 — Move lower editor stack into bottom drawer

Goal:

- make the graph canvas the primary workspace and remove the long page stack under it

Suggested work:

1. identify the lower editor sections currently rendered after the graph canvas
2. extract them into a single composite editor-support panel
3. render that panel inside `BottomDrawerSheet`
4. add a `FloatingBottomAction` trigger in edit mode
5. make sure the drawer works consistently in both layout modes

Potential touchpoints:

- `frontend/src/features/module-graph/module-graph-page.tsx`
- possibly new helper component(s), for example:
  - `workflow-editor-drawer.tsx`
  - `workflow-editor-support-sections.tsx`

### Phase 3 — Refine overlay navigation

Goal:

- improve usability after the initial move

Possible follow-up work:

- add section shortcuts or tabs
- improve which section opens by default based on context
  - selected node -> open inspector first
  - validation failure -> open validation first
  - execution selected -> open results first
- consider preserving the last opened drawer section in local UI state

## Recommended Behavioral Rules

### Sidebar rules

- floating visual state is automatic by default
- if the user explicitly locks the sidebar, user intent wins over automatic floating behavior
- lock/unlock affordance must be obvious and reversible

### Workflow editor rules

- the graph canvas is the default focus area
- support panels should not compete with the graph canvas for page height
- support panels should be reachable without leaving edit mode
- overlay scrolling should happen inside the overlay, not by making the full editor page excessively tall

## Risks / Things To Watch

### 1) Do not break existing shared sidebar users accidentally

`ExplorerSidebar` is used in multiple places.

Any lock/pin enhancement should be introduced carefully so that:

- existing sidebar callers keep current behavior by default,
- the new behavior is opt-in if necessary,
- workflow-editor needs are met without destabilizing other pages.

### 2) Avoid turning the bottom drawer into another overloaded page

If every support panel is dumped into one long scroll surface, the drawer may become hard to use.

That is why section navigation should be considered early, even if a tab system is delayed.

### 3) Preserve important edit actions

The moved panels include critical actions such as:

- save/update workflow
- execute selected node
- validation review
- execution result review

The drawer design must keep those actions easy to find.

### 4) Make wheel interaction better, not different-but-still-bad

The main reason for the rework is graph-wheel usability.

That means the final design should be checked against:

- graph zoom wheel
- page scroll
- drawer internal scroll
- desktop and narrower layouts

## Open Questions

1. Should sidebar lock state persist only during the current page session, or across refreshes via localStorage/settings?
2. Should the bottom overlay open to the last-used section, or contextually choose a section each time?
3. Should the overlay contain one continuous vertical stack first, or start with tabs from day one?
4. Should the workflow list sidebar itself also gain a compact header action for lock/unlock, in addition to any bottom floating button?
5. Should the execution results inside the future drawer already follow the separate summary/detail rework plan, or remain unchanged until that plan is implemented?

## Recommended First Pass

When implementation starts, the safest order is:

1. add sidebar floating lock / restore behavior,
2. move the lower editor stack into a shared bottom drawer,
3. then refine drawer navigation and internal information density.

This preserves the graph canvas while improving the surrounding workflow-editor ergonomics in a way that matches the existing shared CoNAI UI patterns.
