# Generation History Preview Stability TODO

## Phase 1. Minimal readiness-boundary fix

- [x] Write the English plan before implementation.
- [x] Tighten `GenerationHistoryModel.findAllWithMetadata()` so `actual_composite_hash` is only exposed when joined `main_db.media_metadata` exists.
- [x] Apply the same readiness rule to `GenerationHistoryModel.findByIdWithMetadata()` for consistency.
- [x] Verify the backend build.

## Notes

- This is the smallest safe fix for the current symptom.
- The broader architectural issue, "history completed" versus "preview really ready", may still deserve a later deeper cleanup, but that is outside this slice.
