# Image Similarity Routes Refactor Plan

## Goal

Refactor the oversized image similarity route module into a structure that is easier to maintain without scattering the behavior across too many files.

Primary target:
- `backend/src/routes/images/similarity.routes.ts`

## Why this refactor

The current route file combines several concerns:
- image identifier parsing
- query parsing and normalization
- legacy image-id compatibility branches
- repeated error-to-status mapping
- response enrichment
- multiple route handlers for duplicate, similar, color-similar, rebuild, stats, and bulk deletion flows

That makes route-level behavior harder to scan and increases repetition.

## Refactor intent

Keep the route file as the obvious place to find the endpoints.
Extract only the repeated support logic.
Do not turn each route into its own file unless the result still stays easy to navigate.

## Desired shape

Keep `similarity.routes.ts` as the public route surface.
Move repeated support logic into one or two nearby helpers, for example:

- `similarity-route-helpers.ts`
  - identifier parsing
  - shared number/query parsing helpers
  - shared legacy-image validation helpers
  - repeated result enrichment helpers
  - shared error-to-status mapping

If needed, optionally add a second helper only for rebuild/stat reporting helpers, but avoid over-splitting.

## Non-goals

- No API contract changes
- No changes to similarity algorithms
- No changes to safety behavior
- No broad route reorganization beyond maintainability improvements

## Constraints

- Keep hidden-image safety behavior intact
- Keep legacy image-id support intact
- Keep endpoint paths and response shapes intact
- Avoid touching unrelated route files

## Verification

Minimum verification:
- `npm run build` in `backend`
- quick read-through to confirm duplicate/similar/color endpoints still preserve current validation and error mapping

## Success criteria

The refactor is successful if:
- the route file becomes materially smaller or clearer
- shared parsing/error/enrichment logic is easy to find
- the number of new files stays small
- the route surface remains easy to scan
