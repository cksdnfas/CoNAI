# Module Graph Video Support Plan, 2026-04-19

## Goal
Make `generation?tab=workflows` handle ComfyUI video outputs reliably enough for real workflow authoring and execution, using the existing media-aware generation/history work as the foundation.

This wave is intentionally practical. The immediate goal is not a perfect new media-type architecture. The immediate goal is to remove the current image-only assumptions that break or hide video outputs in module-graph workflows.

## Current Findings
- The biggest backend blocker is `backend/src/services/graph-workflow-executor/execute-comfy.ts`, which still uses the image-only path (`generateImages`, first `imagePaths[0]`, forced `artifact_type: 'image'`, forced `mimeType: 'image/png'`).
- Module-graph type definitions still have no dedicated `video` port type in:
  - `backend/src/types/moduleGraph.ts`
  - `frontend/src/lib/api-module-graph.ts`
- Several module-graph UI surfaces still treat only `image` and `mask` artifacts as visual previews, even though the shared preview primitives can already render video when given the correct URL and MIME.
- The built-in `system.final_result` node already accepts `any`, which means final-result registration itself is not the core blocker.
- The output-management browser path is already closer to video-safe because it uses MIME and file-extension based visual detection instead of only `artifact_type === 'image'`.

## Working Rules
- Prefer the smallest compatibility fix that makes real video workflows usable.
- Reuse the existing media-aware ComfyUI and shared preview infrastructure instead of inventing a second pipeline.
- Keep `system.final_result` behavior unchanged.
- Avoid broad graph-schema redesign unless the compatibility pass proves insufficient.
- Verify backend and frontend slices independently before combined verification.
- Keep new comments short, English, and searchable.

## Success Criteria
1. A module-graph ComfyUI execution can persist a final video output without forcing it through the image-only path.
2. A stored video output can appear in module-graph execution results and final-result surfaces instead of showing as missing or text-only.
3. Shared module-graph preview surfaces render video through the existing reusable media components.
4. Existing image workflows remain stable.
5. Frontend and backend builds pass.

## Delivery Strategy

### Track A, Backend execution contract (parallel sub-agent lane)
Scope:
- `backend/src/services/graph-workflow-executor/execute-comfy.ts`
- supporting ComfyUI service/public return shape if needed
- graph artifact persistence metadata for non-image outputs

Direction:
- Replace the current image-only execution assumption with a media-aware output selection path.
- Preserve real output file extension and MIME when saving graph execution artifacts.
- Use the existing ComfyUI media classification work where possible.
- Keep the first pass conservative: one representative final output is acceptable if the graph runtime currently expects one primary output artifact.

Expected result:
- Graph executions stop forcing video outputs into `image/png` metadata.
- Video outputs become valid stored artifacts for downstream final-result and preview handling.

### Track B, Frontend module-graph visual surfaces (parallel sub-agent lane)
Scope:
- `frontend/src/features/module-graph/components/execution-artifact-card.tsx`
- `frontend/src/features/module-graph/components/graph-execution-panel.tsx`
- `frontend/src/features/module-graph/components/graph-execution-panel-helpers.ts`
- `frontend/src/features/module-graph/module-graph-shared.tsx`
- any nearby final-result/helper surface that still hard-codes `image|mask`

Direction:
- Stop using `artifact_type === 'image' || artifact_type === 'mask'` as the only visual-media check.
- Reuse path/MIME-based media detection so module-graph surfaces treat videos the same way the broader shared media UI already does.
- Keep the compact execution UX unchanged except for correctly rendering video previews.

Expected result:
- Final-result cards, execution summaries, and node output previews can show videos when a valid preview URL exists.

### Track C, Formal graph port typing follow-up (serial, only if needed)
Scope:
- `backend/src/types/moduleGraph.ts`
- `frontend/src/lib/api-module-graph.ts`
- graph validation and authoring surfaces

Direction:
- Evaluate whether a dedicated `video` port type is necessary after the compatibility pass lands.
- If current workflows can operate cleanly with preserved MIME/path metadata and existing `any`/`file` handling, defer this to a later wave.
- If the compatibility pass reveals ambiguous edge validation or poor authoring clarity, introduce `video` as a formal port type in a focused follow-up.

Expected result:
- Either a deliberate deferral with clear rationale, or a contained follow-up change instead of an accidental schema sprawl.

## Execution Order
1. Write the plan and TODO docs.
2. Start Track A and Track B in parallel.
3. Land the smallest backend media-aware execution change first if frontend work depends on its metadata shape.
4. Merge frontend visual-surface updates once the artifact contract is stable.
5. Reassess whether Track C is actually required.
6. Run targeted builds, then combined verification.

## Verification Plan
- Backend lane:
  - `npm run build:backend`
- Frontend lane:
  - `npm run build:frontend`
- Final verification:
  - `npm run build:frontend && npm run build:backend`

## Non-Goals
- No full module-graph media architecture rewrite in this wave.
- No broad redesign of graph execution storage.
- No unrelated cleanup of module authoring UX.
- No speculative support for every possible non-image artifact type beyond what is needed for current ComfyUI video outputs.
