# Group Model Refactor TODO

- [x] Re-read `backend/src/models/Group.ts` and mark stable responsibility boundaries
- [x] Keep `Group.ts` as the public group-model surface
- [x] Extract group image query helpers into a nearby helper module if the cut stays modest
- [x] Preserve visible-score safety filtering in all group image read paths
- [x] Preserve random/preview image selection behavior
- [x] Preserve group membership mutation behavior
- [x] Run `npm run build` in `backend`
- [x] Do a final pass to ensure the split is still modest
- [ ] Stage only the group-model-refactor-related files
