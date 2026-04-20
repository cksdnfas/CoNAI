# Video Optimization TODO, 2026-04-20

## Rules
- Keep the first wave narrow.
- Do not add original/optimized dual retention in this pass.
- Do not expand scope to GIF optimization in this pass.
- Reuse one shared H.264 MP4 helper across all ingress paths.
- Verify both backend and frontend before closing the wave.

## Track A, Settings foundation
- [x] Add `videoOptimization` types to backend/frontend settings definitions.
- [x] Add defaults, merge behavior, and missing-field migration handling in settings storage.
- [x] Add a backend settings update method and `/api/settings/video-optimization` route.
- [x] Add frontend settings API wiring.
- [x] Add a settings tab for video optimization presets and advanced CRF/audio fields.
- [x] Verify with `npm run build:frontend` and `npm run build:backend`.

## Track B, Shared transcoding helper
- [x] Add one backend service that transcodes a source video into H.264 MP4.
- [x] Keep original resolution.
- [x] Use browser-safe playback flags for the current UI model.
- [x] Keep the helper reusable from upload, generated-output, and backup-import flows.

## Track C, Upload adoption
- [x] Apply the new helper inside `backend/src/services/videoProcessor.ts` when upload optimization is enabled.
- [x] Keep final metadata extraction and hashing based on the final persisted file.
- [x] Keep response shape unchanged.

## Track D, Generated output adoption
- [x] Apply the new helper inside `backend/src/utils/fileSaver.ts` for generated video outputs.
- [x] Keep static images and GIF-like flows unchanged.
- [x] Ensure final MIME/path reflect the final persisted file.

## Track E, Backup import adoption
- [x] Apply the new helper inside `backend/src/services/backupSourceWatcherService.ts` for imported videos.
- [x] Preserve existing image import mode behavior.
- [x] Normalize optimized backup videos to `.mp4` target paths.

## Final verification
- [x] Run `npm run build:backend`.
- [x] Run `npm run build:frontend`.
- [ ] Run `python -m graphify update .`.
- [ ] Summarize what landed and what still remains.
