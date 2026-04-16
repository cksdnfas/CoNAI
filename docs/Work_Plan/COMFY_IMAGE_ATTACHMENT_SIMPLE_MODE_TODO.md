# Comfy Image Attachment Simple Mode TODO

## Phase 1 - Metadata
- [x] Add `simple_upload_only` to frontend/backend workflow marked-field types
- [x] Expose the toggle in the Comfy workflow marked-field editor for image fields

## Phase 2 - Runtime wiring
- [x] Add upload-only mode to `ImageAttachmentPickerButton`
- [x] Hide non-upload sources when upload-only mode is enabled
- [x] Wire the field flag through Comfy workflow field rendering

## Phase 3 - Verification
- [x] Run frontend build
- [ ] Confirm normal image fields still show all attachment sources
- [ ] Confirm simple-mode image fields show upload only
- [ ] Confirm public Comfy workflow page follows the same behavior
