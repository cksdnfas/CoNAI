# CoNAI Backend — Image Similarity & Duplicate Detection

Date: 2026-03-21
Project: CoNAI

## Summary
The backend already contains a usable similarity / duplicate detection foundation.
It is not just a schema stub — it includes:
- hash generation,
- background rebuild flows,
- duplicate lookup,
- similar-image lookup,
- color-similarity lookup,
- duplicate-group discovery,
- and auto-collection conditions based on duplicate classes.

## Current data model
Primary metadata lives in `media_metadata`.
Relevant fields already exist:
- `composite_hash`
- `perceptual_hash`
- `dhash`
- `ahash`
- `color_histogram`
- width / height / thumbnail / first_seen_date and related metadata

Related files:
- `backend/src/database/migrations/000_create_all_tables.ts`
- `backend/src/models/Image/MediaMetadataModel.ts`
- `backend/src/models/Image/ImageSimilarityModel.ts`
- `backend/src/services/imageSimilarity.ts`

## How hashing works today
### Still images
For still images, the backend generates:
- pHash (`perceptual_hash`)
- dHash (`dhash`)
- aHash (`ahash`)
- color histogram (`color_histogram`)

The current composite hash is built from:
- perceptual hash
- dHash
- aHash

Implementation:
- `backend/src/services/imageSimilarity.ts`
- `backend/src/services/backgroundProcessorService.ts`

### Video / animated files
For videos and animated files, the system currently uses an MD5 file hash as `composite_hash`.
That means:
- exact file-level duplicate detection is possible,
- but visual near-duplicate detection for videos is not implemented at the same level as still images.

Implementation:
- `backend/src/services/backgroundProcessorService.ts`
- `backend/src/utils/fileHash.ts`

## Existing API surface
### Per-image duplicate search
- `GET /api/images/:id/duplicates`
- Route file: `backend/src/routes/images/similarity.routes.ts`
- Uses perceptual hash hamming distance
- Default threshold: `NEAR_DUPLICATE = 5`

### Per-image similar search
- `GET /api/images/:id/similar`
- Supports:
  - `threshold`
  - `limit`
  - `includeColorSimilarity`
  - `sortBy`
  - `sortOrder`
- Default threshold: `SIMILAR = 15`

### Per-image color-similarity search
- `GET /api/images/:id/similar-color`
- Uses stored `color_histogram`

### Global duplicate groups
- `GET /api/images/duplicates/all`
- Returns grouped duplicate clusters
- Supports `threshold` and `minGroupSize`

### Rebuild / maintenance
- `POST /api/images/similarity/rebuild`
  - Rebuild missing image perceptual/color metadata for existing metadata rows
- `POST /api/images/similarity/rebuild-hashes`
  - Process unhashed files and assign hashes from the file layer upward
- `GET /api/images/similarity/stats`
  - Reports hashing completion status

## Matching rules currently encoded
Defined in `backend/src/types/similarity.ts`:
- exact duplicate: hamming distance `0`
- near duplicate: hamming distance `<= 5`
- similar: hamming distance `<= 15`
- color similar: separate histogram score path

Current match-type classifier in `ImageSimilarityService.determineMatchType(...)` returns:
- `exact`
- `near-duplicate`
- `similar`

## Existing backend behaviors we can already use
### 1. Exact / near duplicate review UI
Already feasible.
The backend can provide:
- duplicates for one image,
- grouped duplicates across the library,
- enriched file info for review UI.

Good candidates:
- duplicate review page,
- duplicate cleanup queue,
- per-image duplicate side panel,
- bulk delete / keep-one workflows.

### 2. Similar image panel in detail page
Already feasible.
The backend can already return visually similar images using perceptual hashes.
This is suitable for:
- “similar works” in the detail page,
- cluster browsing,
- inspiration / variant navigation,
- same-subject exploration.

### 3. Color-based exploration
Already feasible.
The color histogram route supports:
- palette-adjacent browsing,
- mood / tone exploration,
- alternate ranking or blending with perceptual similarity.

### 4. Hash coverage monitoring / rebuild tools
Already feasible.
The backend already exposes rebuild and stats endpoints, so admin tooling can surface:
- how many files are still unhashed,
- whether rebuild is needed,
- progress-oriented maintenance actions.

### 5. Rule-based auto collection using duplicate classes
Already partially implemented.
There is duplicate-aware auto-collection logic under:
- `backend/src/services/autoCollection/evaluators/duplicateEvaluator.ts`
- `backend/src/services/autoCollection/autoCollectionOrchestrator.ts`

This means the backend can already drive rules like:
- exact duplicates,
- near duplicates,
- similar duplicates,
- custom hamming thresholds.

## Important limitations in the current implementation
### 1. Similarity search is not ANN / vector-index based
The current model loads candidate rows and compares hashes in application code.
That is practical now, but it is not a high-scale nearest-neighbor engine.
For large libraries, endpoints may need:
- stronger candidate prefiltering,
- cached result sets,
- background materialization,
- or a future vector / ANN path.

### 2. Still-image logic is much stronger than video logic
Still images have perceptual and color-based similarity.
Videos / animated files currently rely on MD5 file hashing, which is effectively exact-file duplicate detection.
So near-duplicate video similarity is not a solved feature yet.

### 3. Duplicate grouping is batch-oriented and can become expensive
`findAllDuplicateGroups()` is functional, but it is fundamentally pairwise-ish work over hashed metadata.
That is acceptable for admin tools or maintenance views, but should be treated carefully for always-live main UI usage.

### 4. Metadata filtering is lightweight, not semantic
The duplicate search includes optional width/height-range filtering for performance.
This helps, but it is still a heuristic filter, not a learned embedding model.

## Recommended product work based on what already exists
### High-confidence features we can build now
1. Detail page “similar images” rail
2. Detail page “duplicates” rail
3. Duplicate review / cleanup page
4. Admin similarity-health panel
5. Rebuild-hashes maintenance action
6. Auto-collection presets for duplicate buckets

### Medium-confidence extensions
1. Mixed ranking: perceptual similarity + color similarity
2. Duplicate merge / canonical-pick workflow
3. Group-level duplicate surfacing in Home / Search
4. Smart download / export dedupe behavior

### Not yet ready without more backend work
1. Embedding-based semantic similarity
2. Strong near-duplicate video similarity
3. Internet-scale or very-large-library ANN search
4. “Same character / same scene” understanding beyond visual hash heuristics

## Frontend opportunities
For the current frontend rebuild, the most realistic next integrations are:
- add a similar-images section to the detail page,
- add duplicate-images section to the detail page,
- add an admin/status surface for similarity rebuild health,
- add a duplicate-review page later if cleanup becomes a core workflow.

## Source map
Main files to inspect when implementing against this system:
- `backend/src/routes/images/similarity.routes.ts`
- `backend/src/models/Image/ImageSimilarityModel.ts`
- `backend/src/services/imageSimilarity.ts`
- `backend/src/services/backgroundProcessorService.ts`
- `backend/src/types/similarity.ts`
- `backend/src/services/autoCollection/evaluators/duplicateEvaluator.ts`
