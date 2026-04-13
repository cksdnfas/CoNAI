# Image Similarity Routes Refactor TODO

- [x] Re-read `backend/src/routes/images/similarity.routes.ts` and identify stable repeated helpers
- [x] Extract shared identifier/query parsing helpers
- [x] Extract shared result-enrichment helpers
- [x] Extract shared legacy image validation helpers if repetition is meaningful
- [x] Extract shared error-to-status mapping helper
- [x] Keep route paths and response shapes unchanged
- [x] Preserve hidden-image safety behavior
- [x] Preserve legacy image-id support
- [x] Run `npm run build` in `backend`
- [x] Do a final pass to ensure the route split is still modest
- [ ] Stage only the similarity-route-refactor-related files
