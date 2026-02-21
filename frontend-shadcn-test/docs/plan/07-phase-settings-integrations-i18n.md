# Phase 07: Settings, Integrations, and i18n

## Objective

Migrate all operational settings and external integration surfaces required for daily use.

## In Scope

- Settings route and feature modules:
  - `frontend/src/pages/Settings/*`
  - feature folders under `frontend/src/pages/Settings/features/*`
- Domains to migrate:
  - General
  - Folder watchers/logs
  - Tagger config/test/batch
  - Similarity test/threshold/scan
  - Rating score/weights/tiers/recalculation
  - Auth settings
  - Civitai settings
  - External API settings
- Supporting pages:
  - ComfyUI servers page
  - Custom dropdown lists page
- i18n parity:
  - locales `ko`, `en`, `ja`, `zh-CN`, `zh-TW`
  - namespace coverage parity with legacy app

## Out of Scope

- Final cutover and hardening gates (Phase 08).

## Work Breakdown

1. Port settings shell and section navigation.
2. Migrate each settings domain in priority order (General -> Folder -> Tagger -> Similarity -> Rating -> Integrations).
3. Port server/custom-list management pages.
4. Add locale resource structure and missing key checks.

## Commit Checkpoints

- `feat(shadcn-phase-07): migrate settings shell and general/folder sections`
- `feat(shadcn-phase-07): migrate tagger and similarity settings`
- `feat(shadcn-phase-07): migrate rating and auth/integration settings`
- `feat(shadcn-phase-07): migrate comfyui server and custom list pages`
- `chore(shadcn-phase-07): add locale parity resources and missing-key checks`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Locale key consistency check script (add if missing)

Manual:

- Save/reload settings for each domain and verify persistence.
- Run tagger/similarity test actions and validate status views.
- Switch languages and confirm no missing translation labels in migrated routes.

## Exit Criteria

- Settings and integration routes are parity-complete.
- Multi-language UI works across all migrated domains.

