# Image Similarity Refactor Plan

## Goal

Refactor the oversized image-similarity backend model into a structure that is easier to maintain and reason about, without over-fragmenting the feature.

Primary target:
- `backend/src/models/Image/ImageSimilarityModel.ts`

## Why this refactor

The current file has grown large enough to mix several responsibilities:
- media metadata loading and guard checks
- safety-policy gating for hidden images
- duplicate/similar/color candidate SQL construction
- multi-hash scoring and match assembly
- duplicate-group orchestration
- legacy image-id compatibility wrappers

This makes the file harder to review, debug, and extend safely.

## Refactor intent

Keep the public API easy to find.
Do not split aggressively.
Prefer a small number of focused helper modules with obvious names.

## Desired shape

Keep `ImageSimilarityModel.ts` as the feature entry point.
Move only the heavier internal responsibilities into nearby helpers:

- `image-similarity-query-builder.ts`
  - metadata bounds
  - duplicate/similar/color candidate queries
  - shared visible-score condition attachment

- `image-similarity-match-builder.ts`
  - similarity component score initialization
  - per-hash scoring
  - duplicate/similar/color match assembly
  - result sorting helpers

Possible second-pass extraction only if still warranted:
- duplicate-group building logic

## Non-goals

- No behavior change to public route contracts
- No new feature work
- No large-scale architecture rewrite
- No deep separation of legacy compatibility paths unless it cleanly falls out of the refactor

## Constraints

- Keep the code easy to search by domain noun: similarity, duplicate, query, match
- Avoid touching unrelated ongoing work in the repository
- Preserve current safety behavior for hidden images
- Preserve current scoring behavior for duplicate and similar matching

## Verification

Minimum verification for the refactor:
- `npm run build` in `backend`
- quick grep/read sanity check that safety gating remains in all existing candidate paths

## Execution approach

1. Extract query-building helpers first
2. Extract match/scoring helpers second
3. Reduce `ImageSimilarityModel.ts` to orchestration and public entrypoints
4. Run backend build
5. Review for accidental over-splitting and collapse helpers if they became too thin

## Review standard

The refactor is successful if:
- the main model becomes meaningfully smaller
- a maintainer can quickly locate query logic vs scoring logic
- the number of files stays modest
- behavior remains unchanged
