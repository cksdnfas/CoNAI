# CoNAI Image Editor Architecture

## Purpose

This document defines the architecture for a lightweight image editor inside CoNAI.

The editor is not intended to become a full Photoshop-style product. Its purpose is to support the real CoNAI workflows that need:

- image-to-image preparation
- infill mask authoring
- simple image correction before generation
- light Paint-style editing with a small layer stack
- clipboard paste of reference fragments or cutouts

The editor should feel closer to classic Windows Paint with layers than to a general design tool.

## Product Goals

### Primary goals

1. Let users prepare a source image for `img2img` and `infill` without leaving CoNAI.
2. Let users paint and erase infill masks accurately at the original image resolution.
3. Support simple editing operations that are useful in AI workflows:
   - brush
   - eraser
   - mask brush
   - mask eraser
   - crop
   - paste image from clipboard
   - zoom and pan
   - 90-degree rotation
   - horizontal flip
   - simple layer ordering and visibility
4. Keep the output contract compatible with the current generation pipeline:
   - edited source image as `dataUrl`
   - mask image as `dataUrl`

### Non-goals

The first implementation should not include:

- text tool
- shape library
- arbitrary filters
- color grading panels
- complex selection algebra
- vector editing
- timeline animation
- collaborative editing

## Why `react-konva`

`react-konva` is the best fit for this feature because CoNAI needs explicit canvas control more than generic media-editing widgets.

The important requirements are:

- precise pointer handling
- stable coordinate transforms under zoom, pan, rotation, and flip
- document-space drawing that stays correct at original resolution
- clipping to image bounds
- lightweight layer rendering
- export control for source and mask images

A higher-level editor framework would add more UI surface than CoNAI needs while reducing control over the mask workflow.

## Scope of the first shipping editor

### Supported document model

The first shipping version uses a simple document model:

- one base raster image
- zero or more user layers
- one dedicated mask layer
- view transform state

### User layer types

The first shipping version supports these layer types:

1. **Draw layer**
   - brush strokes
   - eraser strokes
2. **Paste layer**
   - pasted bitmap image
   - movable on canvas

The base image is treated as immutable document background during a session.

The mask layer is separate from the visible paint layers because it has a different export meaning.

## Editor modes

### Image editing modes

- Pan
- Brush
- Eraser
- Crop

### Mask editing modes

- Mask Brush
- Mask Eraser

Mask editing is always document-space editing on a dedicated mask surface.

## Coordinate model

The editor must separate:

- **document coordinates**: original image pixel space
- **view coordinates**: current on-screen position after pan, zoom, rotation, and flip

All editing data should be stored in document coordinates.

This rule is critical because:

- the user can zoom without affecting export quality
- the user can rotate the view while still painting correctly
- the output must match the original pixel grid

## Rendering model

The main stage renders:

1. checker or neutral workspace background
2. clipped document group
3. base image
4. visible user layers in stack order
5. mask overlay preview
6. crop overlay when crop mode is active

The document group should be clipped to the source image rectangle so drawing never leaks outside the image bounds.

## Export model

The editor exports two independent outputs.

### Source export

The source export is a flattened raster image composed from:

- base image
- visible draw layers
- visible paste layers

The export must be rendered at the original document resolution.

### Mask export

The mask export is a grayscale PNG-style image composed from:

- black background
- white mask regions

The mask output should be exported only when mask editing is enabled by the caller.

### Rotation and flip behavior

Rotation and horizontal flip are part of the document output, not only the temporary viewport.

If the user rotates the working image by 90 degrees and saves, the exported source and mask should reflect the rotated result.

## Crop behavior

Crop is a document operation.

When the user applies a crop:

- the current visible source composition is flattened into a new base raster
- the current mask composition is flattened into a new mask raster
- the document bounds become the crop bounds
- temporary user layers are reset against the new document

This behavior is intentionally simple and matches the lightweight Paint-like goal.

## Layer behavior

### Required layer actions

- create draw layer
- select active layer
- toggle visibility
- move layer up
- move layer down
- remove layer

### Simplifications

The first version does not need:

- per-layer blend modes
- per-layer rotation
- per-layer resize handles
- layer groups
- adjustment layers

## Clipboard paste behavior

The editor should support pasted image data from the system clipboard.

Expected user flow:

1. user copies an image from outside CoNAI
2. user presses `Ctrl+V` while the editor is open
3. the pasted bitmap becomes a new paste layer centered in the document

A toolbar button may also trigger browser clipboard read where supported, but keyboard paste should remain the primary interaction.

## Integration points

### First integration target

The first integration target is the NAI generation panel:

- `img2img` source image editing
- `infill` source image editing
- `infill` mask authoring

### Caller contract

The editor modal should accept:

- initial source image
- optional initial mask image
- whether mask editing is enabled
- save callback returning edited source and optional mask

## Data flow in V1

1. user selects a source image through the existing picker
2. user opens the editor
3. editor loads source image and optional mask
4. user edits image and mask
5. editor returns:
   - updated source `SelectedImageDraft`
   - updated mask `SelectedImageDraft | undefined`
6. NAI form state updates in place
7. existing generation request builder keeps sending `dataUrl` values to the backend

No new backend contract is required for the first shipping version.

## Future extension path

The architecture should allow later expansion to:

- image-detail save workflows
- save/canvas workspace persistence
- shared editor entry points from generation, gallery, and workflow tools
- richer selection tools
- resize operation
- canvas gallery reopening

These are future steps and should not complicate the first implementation.

## Acceptance criteria

The first implementation is acceptable when all of the following are true:

1. A user can open an editor from the NAI source image field.
2. A user can crop, paste, paint, erase, zoom, pan, rotate, and flip.
3. A user can paint and erase a mask for infill.
4. Saving returns updated source and mask drafts without backend API changes.
5. Output remains aligned to the original pixel grid.
6. Drawing remains clipped to the image bounds.
7. The feature builds cleanly inside the current frontend stack.
