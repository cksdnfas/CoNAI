# Image Query File Routes Refactor TODO

- [x] Re-read `backend/src/routes/images/query-file.routes.ts` and identify stable repeated helpers
- [x] Keep `query-file.routes.ts` as the endpoint surface
- [x] Extract repeated response/assembly helpers where it meaningfully reduces route noise
- [x] Extract thumbnail fallback/regeneration support only if it stays easy to trace
- [x] Extract shared batch-download helper logic if repetition is meaningful
- [x] Preserve hidden-image blocking behavior
- [x] Preserve by-path blocking behavior
- [x] Preserve thumbnail regeneration/original fallback behavior
- [x] Run `npm run build` in `backend`
- [x] Do a final pass to ensure the split is still modest
- [ ] Stage only the query-file-refactor-related files
