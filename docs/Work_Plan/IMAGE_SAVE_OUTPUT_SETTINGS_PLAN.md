# CoNAI Image Save Output Settings Plan

## Goal

Add a reusable image-save/output pipeline for CoNAI so users can control image format, quality, and resize behavior before large images are stored or sent to generation APIs.

The feature should support:

- a save-options popup for image save and attachment flows
- a dedicated Settings tab for default output behavior
- shared format/quality/resize handling across the main image-save paths
- UI that stays visually aligned with the current CoNAI system

## Problem summary

Several current flows still keep large original image payloads until the final API request.

Examples already confirmed in the repo:

- generation attachments are often stored as raw `dataUrl` values after direct file reads
- editor save flows still produce large PNG-style `dataUrl` payloads before saving
- some save paths expose only fixed-quality behavior instead of user-selectable format rules

This creates avoidable payload bloat, especially when:

- a large source image is attached to NAI
- a large mask/source pair is carried through editor save
- reusable assets are created from oversized inputs

## Current repo facts

### Existing frontend behavior

Relevant files:

- `frontend/src/features/image-generation/image-generation-shared.tsx`
- `frontend/src/features/image-generation/components/nai-generation-panel.tsx`
- `frontend/src/features/image-generation/components/image-attachment-picker.tsx`
- `frontend/src/features/image-editor/image-editor-modal.tsx`
- `frontend/src/features/images/components/detail/image-edit-action.tsx`
- `frontend/src/lib/api-images.ts`

Confirmed behavior:

- `buildSelectedImageDraftFromFile(...)` currently reads the original file into a `dataUrl`
- NAI source/mask/reference/vibe flows keep that image payload in frontend draft state
- image editor save/export still uses PNG-style `toDataURL(...)` paths in multiple places
- `saveEditedImageToCanvas(...)` exposes only a fixed WebP-quality style input and no save dialog

### Existing backend support

Relevant files:

- `backend/src/routes/images/upload.routes.ts`
- `backend/src/routes/image-editor.routes.ts`
- `backend/src/services/imageMetadataWriteService.ts`
- `backend/src/services/imageMetadataEditService.ts`
- `backend/src/routes/settings/media-settings.routes.ts`
- `backend/src/services/settingsService.ts`

Confirmed backend capabilities:

- image conversion endpoints already support `format` and `quality` in some upload/rewrite flows
- metadata rewrite already supports output format selection
- editor save routes already support quality parameters for WebP save flows
- settings infrastructure already has media-related routes and app settings persistence

### Existing settings structure

Relevant files:

- `frontend/src/features/settings/settings-page.tsx`
- `frontend/src/features/settings/settings-tabs.ts`
- `frontend/src/types/settings.ts`
- `frontend/src/lib/api-settings.ts`

Current settings tabs are already modular and easy to extend.

## Design target

The system should provide two control layers.

### Layer 1: global defaults

Users can configure default save behavior in Settings.

### Layer 2: per-action override

When enabled, a save-options popup appears before save/attach actions and lets the user override the defaults for that operation.

## UX rules

These rules are mandatory for implementation.

1. Do not add verbose instructional copy to the UI.
2. Reuse existing shared UI primitives wherever possible.
3. Match existing CoNAI settings-page and modal styling.
4. Keep save controls short, dense, and practical.
5. Prefer existing shared controls before adding new styling systems.

## UI implementation rules

### Use shared UI components

Prefer these existing patterns/components where they already fit:

- `SettingsModal`
- `SectionHeading`
- `Button`
- `Input`
- `Select`
- `Badge`
- `Card` / `CardContent`
- `ScrubbableNumberInput`
- current Settings tab navigation pattern

### Do not do this

- no large description paragraphs in modals or tabs
- no one-off custom layout language that conflicts with current settings UI
- no duplicate save forms for each feature when one shared modal can be reused

## Proposed feature scope

### New settings tab

Add a new Settings tab, recommended label:

- `Image Save`

This tab should manage default image-output behavior.

### New global settings shape

Add a new settings section to app settings.

Recommended name:

- `imageSave`

Recommended V1 fields:

- `defaultFormat: 'original' | 'png' | 'jpeg' | 'webp'`
- `quality: number`
- `resizeEnabled: boolean`
- `maxWidth: number`
- `maxHeight: number`
- `alwaysShowDialog: boolean`
- `applyToGenerationAttachments: boolean`
- `applyToEditorSave: boolean`
- `applyToCanvasSave: boolean`

### New shared save-options modal

Create one shared modal for per-action overrides.

Recommended responsibilities:

- choose format
- choose quality when applicable
- choose resize behavior
- show compact source/result dimension summary
- optionally persist as defaults

The modal should be lightweight and action-oriented, not explanatory.

## Shared pipeline architecture

### New frontend utility

Create a shared image-output pipeline utility.

Recommended location:

- `frontend/src/lib/image-save-output.ts`

Recommended responsibilities:

- load image from `File`, `Blob`, or `dataUrl`
- resize when needed
- encode to `png`, `jpeg`, or `webp`
- apply quality when needed
- return final `Blob`, `dataUrl`, width, height, and mime type

This utility should be the main reusable building block for all V1 save-option flows.

### Why frontend-first for V1

For the confirmed current flows, frontend pre-processing is the simplest first step because:

- generation attachments already live in frontend draft state
- the biggest immediate win is reducing payload size before request submission
- it avoids adding unnecessary new backend complexity for the first pass

Backend fallback/expansion can come later if needed.

## First implementation targets

### Phase 1: settings and shared pipeline

Deliverables:

- new `imageSave` settings section in frontend/backend types and defaults
- settings API update route for the new section
- new `Image Save` tab in Settings
- shared frontend image-output pipeline utility

Verification:

- app settings load and save successfully
- Settings page renders the new tab correctly
- frontend and backend build successfully

### Phase 2: save-options modal

Deliverables:

- shared save-options modal component
- compact format/quality/resize controls
- default-value hydration from settings
- optional per-action override behavior

Verification:

- modal opens with current defaults
- changing options updates preview summary values correctly
- no excessive helper text appears in the UI

### Phase 3: NAI attachment flow integration

Apply the new pipeline to:

- source image
- mask image
- vibe image
- character reference image

Verification:

- attached images can be resized/re-encoded before storing in form state
- selected images still preview correctly
- payload size is reduced when compression settings are enabled

### Phase 4: image editor and canvas save integration

Apply the new pipeline to:

- editor save back into NAI source/mask drafts
- save-to-canvas flow for edited images

Verification:

- edited image save can use selected format and quality
- canvas save respects the configured output behavior
- no broken editor save regressions

## V1 non-goals

The first implementation pass should not attempt all of these at once:

- upload-page full pre-upload optimization for every upload path
- backend-only re-encoding for all image endpoints
- advanced presets system beyond one global default set
- per-feature independent settings pages
- rich before/after preview comparison UI

These can be added later if the shared pipeline proves stable.

## Proposed file additions

Likely new frontend files:

- `frontend/src/features/settings/components/image-save-tab.tsx`
- `frontend/src/components/media/image-save-options-modal.tsx`
- `frontend/src/lib/image-save-output.ts`

Likely touched frontend files:

- `frontend/src/features/settings/settings-page.tsx`
- `frontend/src/features/settings/settings-tabs.ts`
- `frontend/src/types/settings.ts`
- `frontend/src/lib/api-settings.ts`
- `frontend/src/features/image-generation/image-generation-shared.tsx`
- `frontend/src/features/image-generation/components/nai-generation-panel.tsx`
- `frontend/src/features/images/components/detail/image-edit-action.tsx`
- `frontend/src/lib/api-images.ts`

Likely touched backend files:

- `backend/src/types/settings.ts`
- `backend/src/services/settingsService.ts`
- `backend/src/routes/settings/media-settings.routes.ts`

## Technical rules

1. Keep comments in English.
2. Reuse current settings-page structure instead of inventing a new settings layout.
3. Prefer one shared save modal over multiple feature-specific save popups.
4. Do not duplicate encoding logic in multiple components.
5. Do not add large explanatory text blocks to Settings or save modals.
6. Keep the first pass focused on image formats, quality, and resize limits.

## Validation checklist

### Functional

- [ ] new `Image Save` settings tab exists
- [ ] settings persist correctly after reload
- [ ] shared save-options modal opens from supported flows
- [ ] user can choose `png`, `jpeg`, or `webp`
- [ ] user can set output quality
- [ ] user can set max width and height
- [ ] NAI attachments can be processed before form-state storage
- [ ] editor save can respect configured output options
- [ ] canvas save can respect configured output options

### Technical

- [ ] frontend build succeeds
- [ ] backend build succeeds
- [ ] settings serialization stays backward-compatible
- [ ] no duplicated one-off save-option UIs are introduced
- [ ] existing theme tokens and shared components are reused

## Risks

### Risk: too many save-entry points at once

There are multiple image-handling flows in the repo.

Mitigation:

- implement the shared pipeline first
- integrate NAI attachments first
- integrate editor save second
- defer upload-wide optimization until the shared path is proven stable

### Risk: overcomplicated modal UX

A save-options popup can easily become cluttered.

Mitigation:

- keep fields limited to format, quality, resize, and save-defaults behavior
- avoid explanatory paragraphs
- use the existing modal and form primitives

### Risk: format-specific corner cases

PNG, JPEG, and WebP do not behave the same for alpha and quality.

Mitigation:

- keep V1 transparent about available formats
- disable or handle unsupported quality semantics cleanly in the shared pipeline
- verify alpha-sensitive flows before broad rollout

## Success definition for the next implementation pass

This plan is successful when:

1. the new planning document exists under `docs/Work_Plan`
2. a shared image-save settings model is introduced cleanly
3. a shared save-options modal is implemented without UI clutter
4. NAI attachment flows can apply format/quality/resize rules before sending large payloads
5. the new UI matches the existing CoNAI settings/theme system instead of introducing a parallel style
