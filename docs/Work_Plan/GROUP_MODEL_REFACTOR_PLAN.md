# Group Model Refactor Plan

## Goal

Refactor the oversized group model into a shape that is easier to maintain without over-fragmenting the group feature.

Primary target:
- `backend/src/models/Group.ts`

## Why this refactor

The current file mixes several different responsibilities:
- group CRUD
- group hierarchy lookups
- group-image membership mutation
- group-image list/file lookup queries
- preview/random image selection
- safety-visible filtering on image reads

This makes the model harder to scan and increases the chance of unrelated changes landing in the same file.

## Refactor intent

Keep `Group.ts` as the obvious entry point for group behavior.
Extract only the heavier image-query responsibilities into nearby helpers.
Do not split CRUD, hierarchy, and image queries into many tiny files.

## Desired shape

Keep `Group.ts` as the public model surface.
Move repeated or heavier image-query behavior into one nearby helper module.

Recommended direction:
- `GroupImageQueries.ts`
  - visible image condition helper
  - group image list queries
  - group image list with files queries
  - random image selection
  - preview image selection
  - image file id / composite hash lookup helpers if it improves clarity

Leave in `Group.ts`:
- CRUD
- hierarchy-oriented methods
- group membership mutation entrypoints
- public orchestration surface

## Non-goals

- No API contract changes
- No changes to safety policy behavior
- No changes to group hierarchy semantics
- No broad rewrite of the group feature

## Constraints

- Preserve current safety-visible filtering exactly
- Preserve current response/data shapes used by callers
- Avoid touching unrelated group route/service files unless required by the refactor

## Verification

Minimum verification:
- `npm run build` in `backend`
- quick read-through to confirm visible-score filtering remains in all group image read paths

## Success criteria

The refactor is successful if:
- `Group.ts` becomes materially easier to scan
- image-query logic becomes easier to find separately from CRUD/hierarchy logic
- the number of files stays small
- safety-sensitive group image reads remain easy to trace
