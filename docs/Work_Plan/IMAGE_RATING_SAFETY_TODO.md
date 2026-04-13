# Image Rating Safety TODO

## Docs
- [x] Write the phase-1 safety plan
- [x] Write the implementation TODO

## Backend
- [ ] Add migration for `rating_tiers.feed_visibility`
- [ ] Extend backend/shared rating types with `feed_visibility`
- [ ] Persist `feed_visibility` in `RatingScoreModel`
- [ ] Validate `feed_visibility` in `RatingScoreService`
- [ ] Return `feed_visibility` from `/api/settings/rating/tiers`
- [ ] Update fresh-install seed/default tier inserts

## Frontend settings
- [ ] Extend `RatingTierRecord` with `feed_visibility`
- [ ] Extend settings draft/edit/save flow for `feed_visibility`
- [ ] Add feed visibility select to the rating-tier settings card

## Feed behavior
- [ ] Add frontend helper to resolve a tier from `rating_score`
- [ ] Add persistent rating badge rendering for feed cards
- [ ] Add preview blur support to image list items
- [ ] Apply hide/blur behavior to Home feed
- [ ] Apply hide/blur behavior to Home search results
- [ ] Apply hide/blur behavior to Group feed

## Verification
- [ ] `npm run build:backend`
- [ ] `npm run build:frontend`
- [ ] Manually verify show / blur / hide behavior in Home
- [ ] Manually verify show / blur / hide behavior in Group
- [ ] Manually verify rating badge visibility on blurred cards

## Follow-up later
- [ ] Detail-page gate
- [ ] Download/raw-file gate
- [ ] Unrated fallback policy
- [ ] Optional admin bypass
