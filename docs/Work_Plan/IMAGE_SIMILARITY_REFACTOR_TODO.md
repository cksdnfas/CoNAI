# Image Similarity Refactor TODO

- [x] Re-read `backend/src/models/Image/ImageSimilarityModel.ts` and mark stable responsibility boundaries
- [x] Extract candidate-query helpers into `image-similarity-query-builder.ts`
- [x] Extract score/match helpers into `image-similarity-match-builder.ts`
- [x] Keep `ImageSimilarityModel.ts` as the public entry surface
- [x] Preserve hidden-image safety gating in duplicate/similar/color and duplicate-group paths
- [x] Preserve current duplicate scoring behavior (`pHash + dHash + aHash`)
- [x] Preserve current similar/color result sorting behavior
- [x] Keep legacy image-id wrappers working
- [x] Run `npm run build` in `backend`
- [x] Do a final pass to ensure the refactor is not over-split
- [ ] Stage only the similarity-refactor-related files
