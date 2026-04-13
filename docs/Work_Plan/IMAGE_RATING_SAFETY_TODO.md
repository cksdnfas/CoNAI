# Image Rating Safety TODO

## Docs
- [x] Write the phase-1 safety plan
- [x] Write the implementation TODO

## Backend
- [x] Add migration for `rating_tiers.feed_visibility`
- [x] Extend backend/shared rating types with `feed_visibility`
- [x] Persist `feed_visibility` in `RatingScoreModel`
- [x] Validate `feed_visibility` in `RatingScoreService`
- [x] Return `feed_visibility` from `/api/settings/rating/tiers`
- [x] Update fresh-install seed/default tier inserts

## Frontend settings
- [x] Extend `RatingTierRecord` with `feed_visibility`
- [x] Extend settings draft/edit/save flow for `feed_visibility`
- [x] Add feed visibility select to the rating-tier settings card

## Feed behavior
- [x] Add frontend helper to resolve a tier from `rating_score`
- [x] Add persistent rating badge rendering for feed cards
- [x] Add preview blur support to image list items
- [x] Apply hide/blur behavior to Home feed
- [x] Apply hide/blur behavior to Home search results
- [x] Apply hide/blur behavior to Group feed

## Verification
- [x] `npm run build:backend`
- [x] `npm run build:frontend`
- [ ] Manually verify show / blur / hide behavior in Home
- [ ] Manually verify show / blur / hide behavior in Group
- [ ] Manually verify rating badge visibility on blurred cards

## Hardening landed after phase 1
- [x] Hide hidden tiers in SQL-backed list queries so `total / hasMore / pagination` stay aligned
- [x] Block hidden images in detail, thumbnail, original file, single download, and batch download routes
- [x] Exclude hidden images from batch thumbnail and auto-folder preview/random flows
- [x] Keep group ZIP downloads aligned with safety-filtered hash loads
- [x] Block hidden images from Civitai temp URLs
- [x] Block hidden images from `/api/images/metadata/:composite_hash`

## Follow-up later
- [ ] Decide whether `blur` should also restrict detail/original/download access
- [ ] Define unrated fallback policy instead of rough `show`
- [ ] Optional admin bypass
- [ ] QA remaining external/share surfaces for hidden-image leaks
