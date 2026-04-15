# Wildcard Guest Access Plan

## Goal
- Expose the wildcard workspace as its own page.
- Allow guest accounts to open the wildcard page without opening the rest of image generation.
- Keep the wildcard page UI and behavior aligned with the current wildcard tab.
- Keep LoRA scan admin-only.
- Make wildcard and preprocess edit/delete capabilities configurable from Settings for the guest built-in group.

## Scope
- New standalone route/page for the wildcard workspace.
- New permission keys for wildcard page access and wildcard management actions.
- Backend route split so wildcard read/view operations are not tied to `page.generation.view`.
- Settings security UI update so guest built-in permissions can include wildcard management toggles.
- Reuse existing wildcard workspace components instead of rebuilding the UI.

## Permission Model

### New page permission
- `page.wildcards.view`
  - Opens the standalone wildcard page.
  - Covers viewing all three tabs in the wildcard workspace:
    - Wildcards
    - Preprocess
    - LoRA

### New wildcard action permissions
- `wildcards.edit`
  - Create/update wildcard and preprocess entries.
- `wildcards.delete`
  - Delete wildcard and preprocess entries.
- `wildcards.lora.scan`
  - Run LoRA auto-collection/scan.

## Intended access rules
- Guest can be granted `page.wildcards.view` without `page.generation.view`.
- Guest wildcard page still shows all three workspace tabs.
- LoRA scan controls/actions require admin or `wildcards.lora.scan`.
- Wildcard/preprocess create, update, and delete controls depend on the built-in guest permission configuration.
- Anonymous access stays unchanged.

## Backend Changes
- Add the new permission keys to the default auth catalog.
- Extend the built-in permission matrix API so settings can manage guest built-in permissions beyond only `page.*` entries.
- Separate wildcard route access by responsibility:
  - read/view endpoints -> require `page.wildcards.view`
  - preview/parse utility needed by the page -> require `page.wildcards.view`
  - create/update endpoints -> require `wildcards.edit`
  - delete endpoint -> require `wildcards.delete`
  - LoRA scan endpoint -> require `wildcards.lora.scan`
- Keep admin full access through inherited seeded permissions.

## Frontend Changes
- Add a standalone wildcard page route and lazy route export.
- Resolve `/wildcards` with `page.wildcards.view`.
- Add wildcard page access to the page-access catalog and app navigation.
- Reuse the current wildcard workspace panel rather than duplicating UI.
- Remove wildcard-only guest dependence on the `/generation` page.
- Make action visibility in the wildcard workspace permission-aware:
  - hide/disable edit controls when `wildcards.edit` is missing
  - hide/disable delete controls when `wildcards.delete` is missing
  - hide/disable LoRA scan controls when `wildcards.lora.scan` is missing

## Settings UI Changes
- Keep using the current security/settings permission management flow.
- Expand the built-in guest permission editor so it can toggle:
  - `page.wildcards.view`
  - `wildcards.edit`
  - `wildcards.delete`
- Keep `wildcards.lora.scan` admin-only in practice, even if represented in the permission catalog.
- Preserve the current compact settings style, with no extra explanatory filler.

## Reuse Strategy
- Reuse `WildcardGenerationPanel` as the page body.
- Reuse existing wildcard cards, explorer, preview modal, and editor modal.
- Only extract shared route/page wrappers or small permission helpers when needed.
- Avoid introducing a second divergent wildcard UI.

## Validation
- Guest with only `page.wildcards.view`:
  - can open `/wildcards`
  - can browse wildcard, preprocess, and LoRA tabs
  - cannot open `/generation` unless separately allowed
  - cannot scan LoRA
  - cannot edit/delete without granted action permissions
- Guest with added wildcard action permissions:
  - can edit/delete wildcard and preprocess items according to the toggles
- Admin:
  - retains full wildcard workspace access
- Builds:
  - `npm run build:frontend`
  - `npm run build:backend`
