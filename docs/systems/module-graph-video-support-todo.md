# Module Graph Video Support TODO, 2026-04-19

## Rules
- Bias toward parallel work by default.
- Use serial work only when one lane depends on a stable contract from another lane.
- Keep changes minimal and implementation-focused.
- Reuse the existing shared media and ComfyUI output logic.
- Verify each lane before merging the full result.

## Parallel Lane A, Backend media-aware execution
- [ ] Review `execute-comfy.ts` and remove the current `image/png` hard-coding path.
- [ ] Reuse or expose a ComfyUI service return shape that preserves final output file path, kind, and MIME-relevant information.
- [ ] Save graph execution artifacts with the real output extension and MIME metadata instead of forcing image assumptions.
- [ ] Keep the current workflow result model compatible with `system.final_result`.
- [ ] Verify with `npm run build:backend`.

## Parallel Lane B, Frontend module-graph visual rendering
- [x] Audit every module-graph surface that currently treats only `image|mask` as visual media.
- [x] Replace hard-coded image-only checks with one shared media-visibility helper based on preview URL plus MIME/path detection.
- [x] Ensure final-result cards, execution summaries, and compact artifact cards render videos through `InlineMediaPreview`.
- [x] Keep non-visual text/json artifacts unchanged.
- [x] Verify with `npm run build:frontend`.

2026-05-12 note: the shared preview URL resolver now supports graph temp artifacts, media-record composite hashes, and upload-path references, so queue-backed video/file artifacts can render in execution, final-result, and output-management surfaces instead of disappearing when they are not materialized into `/temp/graph-executions`.

## Serial Gate, Contract alignment
- [ ] Re-check backend artifact metadata shape after Lane A lands.
- [ ] Confirm frontend preview helpers can infer video safely from stored path or metadata without extra API changes.
- [ ] Only add API/type fields if the current metadata is not sufficient.

## Conditional Lane C, Formal `video` port type follow-up
- [ ] Decide whether the compatibility pass is sufficient.
- [ ] If not sufficient, add `video` to backend/frontend `ModulePortDataType` in one focused slice.
- [ ] Update graph edge validation and authoring surfaces only where required.
- [ ] Keep this lane out of the first pass unless it is genuinely necessary.

## Final verification
- [ ] Run `npm run build:backend`.
- [ ] Run `npm run build:frontend`.
- [ ] Run `npm run build:frontend && npm run build:backend`.
- [ ] Summarize what landed in the compatibility pass and whether the formal `video` port lane is still needed.
