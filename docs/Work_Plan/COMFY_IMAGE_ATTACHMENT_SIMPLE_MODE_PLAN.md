# Comfy Image Attachment Simple Mode Plan

## Goal
Add a security-oriented simple mode for ComfyUI image marked fields so some fields can accept only a fresh local upload instead of browsing existing server-side images.

## Scope
First slice only:
- ComfyUI workflow marked fields of type `image`
- internal Comfy workflow generation form
- public Comfy workflow page
- shared attachment picker behavior needed to support upload-only mode

Out of scope for this slice:
- NAI attachment inputs
- module-graph exposed image inputs
- backend-enforced proof that an image came from a fresh upload
- redesigning upload storage or attachment transport

## Requirements
- Workflow author can enable a simple mode per image marked field.
- When enabled, the runtime picker must show only local upload behavior.
- PC must support drag and drop upload.
- Mobile must support tap then file selection.
- Existing `system` and `save` image sources must not be visible or selectable.
- Keep the change conservative and backward-compatible for fields that do not enable the mode.

## Design
1. Extend `WorkflowMarkedField` metadata with a boolean flag such as `simple_upload_only`.
2. Expose that flag in the Comfy workflow authoring marked-field editor only for `image` fields.
3. Extend `ImageAttachmentPickerButton` with an upload-only mode.
4. In upload-only mode:
   - keep only the upload surface
   - hide the source segmented tabs
   - force the active source to `upload`
   - avoid enabling system/save browser queries
5. Pass the field flag from the Comfy workflow runtime field renderer into the shared picker.

## Security note
This first slice is primarily UI-level restriction. It prevents normal users from browsing and selecting existing server images through the picker, but it does not yet make the backend cryptographically prove that the payload came from a fresh upload. If stricter enforcement is needed later, add a second-phase design around temporary upload ids or server-issued upload tokens.

## Verification
- workflow author can toggle simple mode on an image marked field
- saved workflow retains the flag
- internal Comfy runtime field shows upload-only picker when enabled
- public workflow page shows upload-only picker when enabled
- upload-only picker does not render `system` or `save` sources
- frontend build passes
