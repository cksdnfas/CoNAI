# CoNAI Image Editor Implementation Plan

## Goal

Implement a lightweight `react-konva`-based image editor for CoNAI that supports:

- source image editing for `img2img`
- source image plus mask editing for `infill`
- simple Paint-style image operations
- simple layer management

## Current repo facts

### Existing backend support

The backend already supports generation payloads with:

- `image`
- `mask`
- `img2img`
- `infill`

This means the first editor release can stay frontend-only and simply update form drafts.

### Existing legacy evidence

The repository history already contains prior editor experiments, including older `react-konva` implementations with:

- draw layers
- paste layers
- crop support
- zoom and pan logic
- original-resolution export logic

These old implementations should be treated as reference material, not copied verbatim.

### Current integration gap

The current active frontend has image pickers for source and mask images, but no usable in-app editor in the generation flow.

## Delivery strategy

### Phase 1: documentation and scope lock

Deliverables:

- architecture guide
- implementation plan
- explicit V1 scope

Verification:

- docs exist under `docs/GUIDE` and `docs/Work_Plan`

### Phase 2: editor foundation

Deliverables:

- add `konva` and `react-konva`
- create reusable editor feature module
- implement document loading and viewport transform
- implement clipped document rendering

Verification:

- dependency install succeeds
- frontend builds with the new editor module included

### Phase 3: image editing tools

Deliverables:

- pan
- brush
- eraser
- zoom controls
- fit-to-screen
- rotate 90 degrees
- horizontal flip

Verification:

- user can paint and erase correctly under zoom and pan
- saved output preserves original resolution

### Phase 4: mask editing tools

Deliverables:

- dedicated mask brush
- dedicated mask eraser
- mask overlay preview
- mask export as black/white image

Verification:

- saved mask can be reused as `maskImage`
- overlay stays aligned with source after rotate and flip

### Phase 5: simple layer system

Deliverables:

- draw layers
- paste layers
- active layer selection
- visibility toggle
- move up/down
- remove layer

Verification:

- layer order affects source export
- hidden layers do not affect export

### Phase 6: crop and paste

Deliverables:

- crop rectangle workflow
- apply crop to source and mask compositions
- clipboard paste into a new paste layer

Verification:

- crop updates document bounds correctly
- pasted image appears as a movable layer

### Phase 7: NAI integration

Deliverables:

- editor modal launch from source image area
- mask-enabled mode for infill
- save callback updating `sourceImage` and `maskImage`

Verification:

- `img2img` works with edited source output
- `infill` works with edited source + edited mask output

## V1 implementation boundaries

The first coding pass should not add:

- image-detail page integration
- save/canvas persistence workflows
- backend editor endpoints integration
- advanced selection system
- resize tool
- text or shapes

These can be added after the NAI flow is stable.

## Proposed file layout

A minimal reusable structure is preferred.

Suggested location:

- `frontend/src/features/image-editor/`

Suggested files:

- `image-editor-modal.tsx`
- `image-editor-types.ts`
- `image-editor-utils.ts`

If the main modal becomes too large during implementation, split only the parts that are clearly reusable.

## Technical rules

1. Store edit data in document coordinates.
2. Treat zoom and pan as view-only transforms.
3. Keep comments in English.
4. Reuse existing UI primitives from the current frontend.
5. Do not introduce a new backend API for V1.
6. Keep the NAI form contract unchanged.

## Validation checklist

### Functional

- [ ] editor opens from NAI source field
- [ ] brush works
- [ ] eraser works
- [ ] mask brush works
- [ ] mask eraser works
- [ ] crop works
- [ ] paste works
- [ ] rotate works
- [ ] flip works
- [ ] zoom and pan work
- [ ] layer visibility works
- [ ] layer ordering works
- [ ] source export updates the form
- [ ] mask export updates the form

### Technical

- [ ] no backend contract changes required for V1
- [ ] build succeeds
- [ ] no drawing outside image bounds
- [ ] exported image resolution is stable
- [ ] exported mask aligns with source image

## Risks

### Risk: transform bugs

Rotation, flip, zoom, and crop can easily drift out of alignment.

Mitigation:

- keep one canonical document-space model
- render view transforms separately
- test export after every major feature step

### Risk: browser clipboard differences

Clipboard image read support differs by browser.

Mitigation:

- support `paste` event first
- optionally support explicit clipboard read button where available

### Risk: feature bloat

Image editor work grows very easily.

Mitigation:

- keep V1 strictly focused on NAI source and mask preparation
- defer gallery/save/canvas integration until after shipping V1

## Success definition for the current implementation pass

This pass is successful when:

1. the docs are created
2. the editor foundation is added
3. the NAI generation panel can launch the editor
4. the editor can return edited source and mask drafts
5. the new code builds or any remaining failure is clearly isolated and documented
