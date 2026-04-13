# Image Rating Safety Plan

## Goal

Add a first-pass image safety layer for the personal CoNAI server using the existing `rating_score` and operator-managed rating tiers.

This first pass should:
- show a rating badge on image cards
- let each rating tier choose how feed/list items behave
- support `show`, `blur`, and `hide` behavior in Home, Group, and Home-search results
- stay intentionally rough and practical for a personal server setup

## Important constraints

- Tier names are fully custom and operator-editable.
- Safety logic must **not** depend on tier names like `G`, `Teen`, or `NSFW`.
- For this pass, `rating_score` alone is enough.
- We do **not** need a heavy multi-layer moderation architecture yet.
- A feed-level safety slice is more important than perfect raw-file lockdown in phase 1.

## Phase 1 scope

### Included
- Extend rating-tier settings with a feed visibility policy.
- Persist that policy with each tier row.
- Resolve an image tier from `rating_score` against the current tier ranges.
- Show a persistent rating badge on image cards.
- Apply tier-driven list behavior in:
  - Home feed
  - Home search results
  - Group image feed
- Feed behaviors:
  - `show`: normal card
  - `blur`: show card with strong preview blur and visible badge
  - `hide`: remove card from the rendered list

### Not included in phase 1
- Download blocking
- Raw file endpoint blocking
- Detail-page hard blocking
- Role/account-specific safety policies
- Separate unrated / failed-rating moderation flows
- Per-surface custom policies beyond the shared feed/list rule

## Storage design

Use the existing `rating_tiers` table as the single source of truth for tier-level feed safety.

Add one new field:
- `feed_visibility: 'show' | 'blur' | 'hide'`

Reasoning:
- Tier names are editable, so names cannot be used as stable keys.
- The current tier update flow replaces tier rows in bulk, so an external mapping layer would be brittle.
- Storing policy on the tier row keeps the operator-facing model simple and avoids name-based coupling.

## Resolution model

For each image card:
1. read `rating_score`
2. find the matching tier using current min/max tier ranges
3. read that tier's `feed_visibility`
4. render the card accordingly

If `rating_score` is missing or no tier matches:
- phase 1 fallback: treat as `show`
- document this clearly as an intentional rough default for the personal-server slice

## UI plan

### Settings
Extend the existing `평가 등급` editor so each tier also controls:
- feed visibility policy (`표시`, `블러`, `숨김`)

### Card rendering
Add a persistent rating badge to feed cards.

Badge requirements:
- always visible in the list card, not hover-only
- use the current tier label and tier color when available
- remain compatible with existing image list overlays and quick actions

### Blur rendering
For `blur` tiers:
- keep the card in the list
- apply strong preview blur to the media surface
- keep the rating badge visible above the blurred preview

### Hide rendering
For `hide` tiers:
- remove those images before passing items into the feed list renderer
- apply this consistently in Home, Home search, and Group list rendering

## Backend pieces

- migration to add `feed_visibility` to `rating_tiers`
- backend rating types extended to include `feed_visibility`
- rating model create/update/bulk-update paths extended to persist it
- default tier seed updated so fresh DBs get a valid default value

## Frontend pieces

- frontend rating tier record type extended with `feed_visibility`
- settings page draft/save logic extended for the new field
- rating tier settings card adds the visibility select
- image feed helper resolves tier + feed behavior from `rating_score`
- home/group feed components apply hide/blur behavior
- image list component gains persistent overlay and preview blur hooks

## Verification goals

- rating-tier settings save and reload with `feed_visibility`
- Home feed hides tiers set to `hide`
- Home search hides tiers set to `hide`
- Group feed hides tiers set to `hide`
- `blur` tiers remain visible with a strong blur treatment
- visible cards show a persistent rating badge
- frontend build passes
- backend build passes

## Status update after the first slice

The original feed-first slice has already been extended with practical server-side hardening for `hide` tiers.

Already added after the initial plan:
- detail-page hard blocking for hidden images
- raw file / thumbnail / original-download blocking for hidden images
- batch download filtering for hidden images
- SQL-level exclusion for hidden list items so pagination stays consistent
- auto-folder preview/random filtering for hidden images
- group ZIP path aligned with safety-filtered image loads
- Civitai temp URL blocking for hidden images
- metadata route blocking for hidden images

## Follow-up phase after this slice

- decide whether `blur` should stay feed-only or also block detail/download surfaces
- optional admin bypass / account-group policy
- unrated-content policy
- per-surface policy split if Home and Group need different rules later
- final QA sweep for external/share/export paths that can still surface hidden media
