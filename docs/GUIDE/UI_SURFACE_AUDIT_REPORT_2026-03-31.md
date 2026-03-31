# UI Surface Audit Report — 2026-03-31

## Scope

Static code audit of CoNAI frontend surface usage after the surface-standardization pass.

Audit target:
- `frontend/src/features/**/*.tsx`

Audit goal:
- verify that top-level containers, nested blocks, and interactive states follow the intended semantic contract
- identify remaining mismatches and classify whether they are acceptable exceptions or follow-up work

---

## Surface contract used for evaluation

- `surface-container`
  - top-level card / panel surface
  - also allowed for standalone overlays, flyouts, dropdown panels, and graph nodes

- `surface-low`
  - nested container inside a parent panel
  - grouped content block
  - inline utility region

- `surface-high`
  - hover / selected / active interactive emphasis

- `surface-lowest`
  - recessed background / well / deep inset

---

## Audit summary

### 1. Card primitive normalization

Status: **PASS**

Findings:
- `Card` now provides the default top-level panel surface.
- There are **0 remaining `<Card ... bg-surface-* ...>` overrides** across feature pages.
- This is a strong indicator that page-level container semantics are now controlled by the primitive instead of ad hoc overrides.

### 2. General page container consistency

Status: **PASS**

Findings:
- regular page cards across `settings`, `image-generation`, `module-graph`, `prompts`, `groups`, `upload`, and `home` now rely on the shared `Card` baseline
- nested content regions were broadly migrated to `surface-low`
- selected/active states were separated from structural container tones in the reviewed areas

### 3. Remaining `surface-container` usage

Status: **PASS WITH EXCEPTIONS**

Remaining occurrences in `features/**/*.tsx`: **6**

They are all acceptable top-level exceptions under the current rules:

1. `image-generation/components/wildcard-inline-picker-field.tsx`
   - popup suggestion panel
2. `images/components/detail/detail-settings-flyout.tsx`
   - floating flyout panel
3. `image-generation/components/comfy-workflow-authoring-modal.tsx`
   - node authoring graph card
4. `image-generation/components/comfy-workflow-authoring-modal.tsx`
   - authoring empty-state block
5. `image-generation/components/comfy-workflow-authoring-modal.tsx`
   - marked-field item card
6. `module-graph/components/module-graph-node-card.tsx`
   - standalone graph node card

These are not treated as failures because they behave as overlay/top-level surfaces rather than nested page containers.

---

## Feature-by-feature comparison

## Image Generation

Status: **GOOD**

Observed pattern:
- top-level cards use default `Card` surface
- nested sections mostly use `surface-low`
- selected states use `surface-high` or explicit accent treatment
- recessed utility regions use `surface-lowest`

Notes:
- the page is now much closer to the intended hierarchy
- remaining `surface-container` usage is limited to the wildcard popup and workflow authoring/graph-card contexts

Verdict:
- structurally aligned with the new contract
- no broad page-level mismatch remains

## Module Graph

Status: **GOOD**

Observed pattern:
- page cards rely on the default `Card` surface
- nested inspector/execution/asset blocks use `surface-low`
- selected or focusable rows use `surface-high`
- one graph node card intentionally keeps `surface-container`

Verdict:
- aligned
- remaining exception is intentional and semantically valid

## Settings

Status: **GOOD**

Observed pattern:
- general setting cards no longer force `surface-container`
- nested resource rows use `surface-low`
- selected rows use `surface-high`
- hover is separate from the base row surface

Verdict:
- aligned
- settings now reflects the intended “container 1 / container 2 / selected state” model much more clearly

## Prompts

Status: **GOOD**

Observed pattern:
- panel cards use the default `Card` surface
- sidebar and toolbar icon actions use `surface-low`
- interactive emphasis is limited and appropriate

Verdict:
- aligned
- no obvious semantic inversion remains in the audited code

## Groups / Upload / Home

Status: **GOOD**

Observed pattern:
- redundant top-level `Card` surface overrides were removed
- nested and interactive surfaces remain in place where needed

Verdict:
- aligned
- no obvious container/hover confusion remains in the audited code

## Images Detail

Status: **GOOD WITH EXCEPTION**

Observed pattern:
- metadata item blocks were moved to `surface-low`
- the floating settings flyout retains `surface-container`

Verdict:
- aligned
- flyout exception is valid

## Search

Status: **GOOD**

Observed pattern:
- search scope tab wrapper now uses `surface-low`
- active/hover tab styling remains interactive rather than structural

Verdict:
- aligned

---

## Metrics snapshot

### Surface usage by feature (selected tokens)

| Feature | surface-container | surface-low | surface-high | surface-lowest |
|---|---:|---:|---:|---:|
| settings | 0 | 22 | 16 | 3 |
| image-generation | 4 | 55 | 10 | 7 |
| module-graph | 1 | 46 | 5 | 2 |
| prompts | 0 | 16 | 1 | 4 |
| upload | 0 | 8 | 11 | 0 |
| groups | 0 | 5 | 3 | 2 |
| home | 0 | 5 | 3 | 4 |
| images | 1 | 6 | 3 | 2 |
| search | 0 | 1 | 5 | 0 |

Interpretation:
- `surface-container` is now almost entirely absent from regular page content
- `surface-low` has become the dominant nested-layer token as intended
- `surface-high` remains available for selected/hover emphasis rather than acting as a base layout tone

---

## Issues that are still worth watching

These are not current failures, but they should be watched in visual QA:

1. **Authoring graph cards may still look too similar to their modal shell**
   - because they intentionally keep `surface-container`
   - if visual separation is weak, a future pass may need stronger border/shadow treatment rather than a new token

2. **Settings uses relatively high `surface-high` counts**
   - likely valid because of selected rows and interactive controls
   - worth visual confirmation to ensure emphasis is not overused

3. **Upload and search have concentrated interactive emphasis**
   - likely valid for action-heavy layouts
   - still worth confirming in-browser so active controls do not overpower the parent layout

---

## Overall judgment

Overall status: **PASS**

The site is now materially more consistent.

Most of the original problems have been corrected:
- default card containers are standardized
- nested content is broadly using `surface-low`
- selection/hover emphasis is no longer broadly confused with structural background
- settings labels are closer to runtime behavior
- regular feature pages no longer depend on widespread `surface-container` overrides

Remaining `surface-container` usage is narrow and explainable by the overlay/graph-node exception rule.

---

## Recommended next step

Perform a **visual QA pass in-browser** against these priority screens:

1. Image Generation
2. Module Graph
3. Settings
4. Images Detail
5. Search / Upload

The static audit suggests the semantic structure is now mostly correct. The remaining question is not token misuse, but whether the visual contrast between Container 1, Container 2, and active states feels strong enough in the live UI.
