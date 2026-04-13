# Image Query File Routes Refactor Plan

## Goal

Refactor the image file-serving route module into a shape that is easier to maintain, while keeping the endpoint surface and safety behavior easy to follow.

Primary target:
- `backend/src/routes/images/query-file.routes.ts`

## Why this refactor

The current file still combines several route concerns:
- metadata/detail response assembly
- raw file serving
- thumbnail fallback and regeneration flow
- batch download orchestration
- original download flow
- by-path access checks
- placeholder serving
- repeated response/error handling around those flows

This is especially important because the file sits directly on safety-sensitive read paths.

## Refactor intent

Keep the route file as the visible endpoint surface.
Extract only repeated or heavy support logic.
Do not fragment the serving flows into many tiny files.

## Desired shape

Keep `query-file.routes.ts` as the public route surface.
Use nearby helpers for repeated logic only.

Preferred direction:
- extend the existing `query-file-helpers.ts` when that keeps searchability high
- optionally add one additional nearby helper only if a single helper would become too mixed

Potential extraction areas:
- repeated JSON error responders
- image-with-file response assembly
- thumbnail fallback/regeneration support
- shared batch-download selection and zip assembly helpers
- repeated original-path resolution patterns

## Non-goals

- No endpoint path changes
- No response contract changes
- No safety policy changes
- No rewrite of thumbnail generation behavior

## Constraints

- Preserve hidden-image blocking behavior exactly
- Preserve by-path blocking behavior exactly
- Preserve thumbnail regeneration/original fallback behavior exactly
- Avoid touching unrelated image route files

## Verification

Minimum verification:
- `npm run build` in `backend`
- quick read-through to confirm detail/file/thumbnail/download/by-path routes still preserve current safety behavior

## Success criteria

The refactor is successful if:
- the route file becomes easier to scan
- heavy or repeated support logic moves into obvious nearby helpers
- the number of files stays small
- safety-sensitive checks remain easy to locate
