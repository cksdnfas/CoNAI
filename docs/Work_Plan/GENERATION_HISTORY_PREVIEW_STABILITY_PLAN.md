# Generation History Preview Stability Plan

## Problem

The image-generation history can look unstable right after a generation finishes.

Observed symptoms:
- A history item can appear completed before its preview is actually ready.
- The history list can temporarily show a completed item without a usable thumbnail.
- In some cases the frontend can latch onto an early preview failure and keep showing a placeholder even after the main image pipeline catches up.

## Current Root Cause

The current readiness boundary is too early.

Today the history UI effectively treats a record as preview-ready when `api_generation_history` can join to `main_db.image_files`.
That is not strong enough, because `image_files` can exist before the main metadata + thumbnail pipeline has finished.

Current sequence:
1. Generation output file is saved.
2. `api_generation_history` stores `composite_hash`.
3. Main upload/watch pipeline later creates `image_files` and then `media_metadata` + thumbnail.
4. The history list currently exposes `actual_composite_hash` as soon as `image_files` is present.
5. Frontend sees a preview URL too early and can attempt thumbnail loading before preview readiness is real.

## Minimal Fix Goal

Keep the current queue/history architecture unchanged, but tighten the preview-ready condition.

For the history list/detail surfaces, only expose `actual_composite_hash` when the joined main-db `media_metadata` row exists.

That gives us a safer rule:
- `image_files` only -> not preview-ready yet
- `media_metadata` present -> preview-ready

This is intentionally conservative and avoids changing generation execution flow, queue flow, or background processing order.

## Implementation Scope

Backend only, minimal surface:
- `backend/src/models/GenerationHistory.ts`
  - tighten `findAllWithMetadata()`
  - tighten `findByIdWithMetadata()`

No schema change.
No frontend API contract expansion.
No queue/runtime state-machine changes.

## Expected Behavior After Fix

- Freshly completed generations stay visually in-progress a little longer.
- A history item should not expose preview routes until main-db metadata is ready.
- The history list should stop flipping into a fake-completed state that still cannot serve thumbnails.
- This should reduce the “completed but missing thumbnail” race without changing the broader architecture.

## Risks to Avoid

- Do not delay queue completion semantics.
- Do not add new history columns or speculative readiness flags in this slice.
- Do not broaden the history payload.
- Do not touch unrelated image list or queue UI behavior.

## Verification

1. Trigger a new ComfyUI or NovelAI generation.
2. Observe history immediately after generation finishes.
3. Confirm the item does not become preview-ready until main-db metadata exists.
4. Confirm the item no longer shows a completed-looking state with a broken/missing thumbnail.
5. Verify backend build passes.
