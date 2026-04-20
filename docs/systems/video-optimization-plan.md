# Video Optimization Plan, 2026-04-20

## Goal
Introduce practical video size optimization for the current CoNAI media pipeline without redesigning the whole media architecture.

This wave is intentionally narrow.
The immediate goal is to transcode short user-facing videos into one stable playback format that reduces size while fitting the existing in-app browser playback model.

## Current Decision Snapshot
- codec: `H.264`
- container: `MP4`
- resolution: original size preserved
- original retention: disabled, keep only the encoded file
- likely clip length: usually around 10 seconds, rarely above 20 seconds
- first-pass sources:
  - direct uploads
  - generated outputs such as ComfyUI results
  - backup-source imported videos

## Why This Shape
- H.264 fits the current web playback path much better than H.265 for CoNAI's browser-first UI.
- Short clips make server-side CPU transcoding realistic without needing a broader job system in the first pass.
- Not retaining originals keeps storage policy simple and avoids dual-file state management.
- If transcoding fails or the encoded MP4 is not smaller, the system can safely fall back to a single original-format file.
- Limiting the first pass to three ingress points captures most real video entry flows without touching unrelated video surfaces first.

## Current Findings
- Upload videos currently go through `backend/src/services/videoProcessor.ts` and are effectively stored as original files plus extracted metadata.
- Generated non-image media currently go through `backend/src/utils/fileSaver.ts` and are copied as-is.
- Backup source imports currently copy supported video files as-is in `backend/src/services/backupSourceWatcherService.ts`.
- There is no dedicated `videoOptimization` settings section yet in backend/frontend settings types, storage, or settings routes.
- Bundled FFmpeg on this machine already exposes `libx264` and `aac`, so the first implementation does not need a new external runtime dependency.

## Working Rules
- Keep the first pass contract-preserving for existing APIs where possible.
- Reuse the existing FFmpeg-based video metadata flow instead of inventing a second media stack.
- Treat GIF as out of scope for this pass even though it lives near video classification in some paths.
- Prefer one shared backend transcoding helper over duplicating FFmpeg argument construction.
- Keep new comments short, English, and searchable.

## Scope

### In scope
- backend settings schema for video optimization
- settings API and frontend settings UI for the new section
- shared backend H.264 MP4 transcoding helper
- direct upload video ingestion
- generated video output ingestion
- backup source video imports
- build verification for backend and frontend

### Out of scope for this phase
- H.265 support
- original/optimized dual retention
- GIF optimization changes
- module-graph artifact video optimization
- distributed queueing or asynchronous transcoding workers
- broad download UX redesign around optimized vs original variants

## Recommended Default Behavior
- preset: `balanced`
- default CRF recommendation: `26`
- default audio bitrate recommendation: `128 kbps`
- advanced preset mapping:
  - `high-quality` → CRF 22, audio 192 kbps
  - `balanced` → CRF 26, audio 128 kbps
  - `economy` → CRF 30, audio 96 kbps

## Settings Shape
Proposed first-pass settings section:

- `enabled: boolean`
- `preset: 'high-quality' | 'balanced' | 'economy'`
- `crf: number`
- `audioBitrateKbps: number`
- `applyToUpload: boolean`
- `applyToGeneratedOutputs: boolean`
- `applyToBackupImports: boolean`

Note:
- codec and container stay fixed in v1, so they do not need user-facing settings.
- original retention is intentionally not configurable in this phase.

## Delivery Strategy

### Track A, Settings foundation
Scope:
- `backend/src/types/settings.ts`
- `frontend/src/types/settings.ts`
- `backend/src/services/settingsServiceStorage.ts`
- `backend/src/services/settingsService.ts`
- `backend/src/services/settingsServiceUpdates.ts`
- `backend/src/routes/settings/media-settings.routes.ts`
- frontend settings API and settings tab wiring

Direction:
- add one new `videoOptimization` section end to end
- keep validation small and explicit
- expose the three presets plus advanced CRF/audio controls

Expected result:
- CoNAI can persist and edit video optimization settings without changing unrelated settings contracts.

### Track B, Shared transcoding helper
Scope:
- new backend service helper for H.264 MP4 transcoding

Direction:
- centralize FFmpeg command assembly in one reusable helper
- preserve original resolution
- force browser-safe playback settings for the current app model
- keep the helper synchronous in the request/import flow for this first pass
- allow single-file fallback when optimization is not beneficial

Expected result:
- upload/generated/backup paths can all call the same video optimization helper.

### Track C, Ingress adoption
Scope:
- `backend/src/services/videoProcessor.ts`
- `backend/src/utils/fileSaver.ts`
- `backend/src/services/backupSourceWatcherService.ts`

Direction:
- apply optimization only when the new settings enable it for that ingress path
- write only the final encoded file in the first pass
- preserve existing metadata extraction and hashing flow after the final file is written

Expected result:
- the three main ingress paths converge on one optimized H.264 MP4 storage behavior.

## Execution Order
1. Write the plan and TODO docs.
2. Add the settings foundation first.
3. Land the shared transcoding helper.
4. Adopt it in upload ingestion.
5. Adopt it in generated output ingestion.
6. Adopt it in backup-source imports.
7. Run backend/frontend builds.
8. Refresh Graphify after code changes.

## Verification Plan
- `npm run build:backend`
- `npm run build:frontend`
- targeted sanity checks on the settings page and affected backend compile paths
- `python -m graphify update .`

## Success Criteria
1. CoNAI can store and edit a dedicated `videoOptimization` settings section.
2. Upload videos can be saved as optimized H.264 MP4 files without retaining originals.
3. Generated video outputs can be saved through the same optimization path.
4. Backup-source imported videos can be normalized through the same optimization path.
5. Backend and frontend builds pass.

## First Implementation Slice
The first concrete slice should be:
1. plan + TODO docs
2. settings schema + settings API + settings tab
3. shared backend video optimization helper
4. upload ingestion adoption

If that lands cleanly, generated outputs and backup-source imports should follow immediately after in the same wave.
