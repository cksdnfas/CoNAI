# UI Surface Standardization Plan

## Purpose

Standardize CoNAI surface styling so the site keeps one consistent visual language while remaining fully customizable through the appearance theme system.

This work is focused on fixing the current mismatch between:

- surface token naming
- primitive defaults
- per-page container usage
- hover/active styling
- nested container layering

The first visible priority is the Image Generation page because it currently exposes the most severe inconsistencies.

---

## Problem Summary

The current UI has drifted into an inconsistent state:

1. **Top-level card containers are not consistently using the intended base surface.**
   - Many large panels still inherit a lower-tone background instead of the main card container tone.
2. **Container tones and hover tones are semantically mixed.**
   - Some static containers use tones that should be reserved for interactive hover/active states.
   - Some interactive states visually collapse into the same tone as their parent container.
3. **Nested container behavior is not formally defined.**
   - Several screens use a second container layer, but there is no stable contract for when to use it.
4. **Appearance customization labels do not match runtime semantics.**
   - The current labels imply hover behavior where the token is more useful as a nested container layer.
5. **Pages are styling surfaces ad hoc instead of following a shared semantic contract.**

---

## Standard Surface Contract

The site should converge on the following semantic model.

### Base layers

- `surface-lowest`
  - recessed canvas
  - page wells
  - sidebars / insets / deep background regions

- `surface-container`
  - **Container 1**
  - default top-level card / panel surface
  - primary content containers

- `surface-low`
  - **Container 2**
  - nested sections inside a top-level card
  - grouped form blocks
  - embedded content regions inside a panel

### Interactive layers

- `surface-high`
  - hover state
  - selected-but-not-dominant interactive state
  - active list row / elevated interactive tone

- `surface-highest`
  - stronger selected state
  - emphasized interactive state when extra separation is needed

### Rule of thumb

- Static container -> `surface-container`
- Nested container inside another container -> `surface-low`
- Hover / interactive emphasis -> `surface-high`
- Stronger active / selected emphasis -> `surface-highest`

---

## Phase Plan

## Phase 1 — Foundation

### Goals

- Establish one shared semantic interpretation of surface tokens.
- Align the core `Card` primitive with the intended default container layer.
- Add reusable shared surface classes so new screens stop re-encoding surface meaning ad hoc.
- Update appearance-editor labels so the customization UI matches actual runtime usage.

### Deliverables

- `Card` defaults to the main container surface.
- Shared CSS classes for semantic surface roles.
- Appearance editor labels updated from hover-oriented wording to container-oriented wording.
- This plan document committed to the docs folder.

### Verification

- Frontend build passes.
- Image Generation top-level cards use the same main container tone without one-off overrides.

---

## Phase 2 — Image Generation migration

### Goals

- Make the Image Generation page the first fully normalized screen.
- Separate top-level cards from nested groups.
- Remove cases where inner blocks visually collapse into the same layer as the parent panel.

### Deliverables

- Top-level generation panels use Container 1.
- Nested content groups use Container 2.
- Interactive rows/buttons keep hover emphasis on interactive tones only.
- NAI / ComfyUI / Wildcard surfaces follow the same hierarchy.

### Verification

- Visual inspection of:
  - NAI generation
  - ComfyUI workflow home
  - ComfyUI workflow controller
  - Wildcard workspace
- No major panel appears “flat” because parent and child share the wrong tone.

---

## Phase 3 — Site-wide audit and migration

### Goals

- Apply the same semantic contract across the rest of the site.
- Reduce local surface overrides and move toward reusable patterns.

### Audit targets

- bare `Card` usage
- static blocks using hover tones
- nested containers using the same tone as their parent without intent
- list items whose selected/hover states are indistinguishable
- settings/editor pages whose customization labels drift from actual behavior

### Candidate areas

- module graph side panels
- prompts
- groups
- upload
- settings
- image detail / metadata
- search surfaces

### Verification

- Surface usage is explainable by the shared contract.
- New pages can be styled mostly by primitives and semantic surface classes.

---

## Phase 4 — Optional theme model expansion

This phase should happen **only if the current token set cannot deliver enough separation** after Phases 1–3.

### Possible addition

Introduce an additional explicit nested container token, for example:

- `surface-container-low`
- or `surface-container-2`

### Warning

Adding a new token increases scope significantly because it touches:

- frontend types
- backend types
- default settings
- appearance validation
- presets
- theme variable application
- normalization/import/export logic
- appearance editor UI

This should be treated as a deliberate second-stage change, not the default first move.

---

## Implementation Rules

- Prefer semantic consistency over local one-off styling.
- Prefer shared primitives and shared surface classes over raw ad hoc combinations.
- Keep the number of surface meanings small and stable.
- Do not use hover tones for static containers.
- Floating overlays, flyouts, dropdown panels, and graph nodes may keep `surface-container` when they act as standalone top-level surfaces above the current layout layer.
- Do not add new theme tokens unless the existing contract is proven insufficient.
- Keep changes surgical and directly traceable to the surface-standardization goal.

---

## Success Criteria

The work is successful when:

1. A default `Card` visually reads as the site’s standard panel container.
2. Nested blocks consistently read as a second layer, not as accidental overrides.
3. Hover/active tones are recognizable as interactive emphasis, not structural background.
4. The appearance editor exposes labels that match how the site actually uses the tokens.
5. Theme customization still works globally because the contract is based on shared tokens rather than hardcoded colors.

---

## Initial execution order

1. Create this plan.
2. Normalize `Card` and shared surface semantics.
3. Migrate Image Generation top-level and nested surfaces.
4. Run a frontend build.
5. Continue with a site-wide audit using the same semantic contract.
