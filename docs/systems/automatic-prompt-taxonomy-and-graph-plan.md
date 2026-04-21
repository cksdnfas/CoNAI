# Automatic Prompt Taxonomy and Graph Plan, 2026-04-21

## Goal
Introduce an automatic prompt classification and relationship layer for CoNAI that can group prompt terms by inferred type and semantic family without requiring users to hand-maintain prompt groups first.

This feature should make prompt exploration and auto-prompt construction more useful than a pure co-occurrence graph.

## Product Intent
The new graph system should answer questions like:
- which prompt terms look semantically similar
- which terms appear to be variants of the same concept
- which terms belong to the same inferred type or role
- which terms are often used together
- which nearby terms are good candidates when building a prompt automatically

The UI should support at least two graph modes:
1. usage relationship graph
2. automatic taxonomy or similarity graph

The current co-occurrence graph remains useful, but it should not be treated as the only graph meaning.

## Current State
### What exists today
Current prompt graph behavior is built from `prompt_term_relations` using `relation_type = 'co_occurrence'`.

Current meaning:
- terms are connected when they appeared in the same normalized prompt set
- score is derived from shared usage count normalized by source and target usage
- graph output is filtered by `min_score`, `min_shared_count`, `min_usage_count`, and `limit`

Relevant files:
- `backend/src/services/promptRelationService.ts`
- `backend/src/routes/promptCollection.ts`
- `frontend/src/features/prompts/components/prompt-graph-panel.tsx`
- `frontend/src/features/prompts/prompt-page.tsx`

### Current limitation
The current graph is not an automatic taxonomy graph.
It is a co-usage graph.

That means it naturally over-connects broad utility terms such as:
- quality tags
- count tags
- generic character tags
- broad style tags

This is useful for companion suggestions, but it does not automatically organize terms into meaningful semantic families or inferred prompt roles.

## Desired Outcome
The system should automatically infer structure such as:
- quality terms
- character or subject terms
- composition terms
- pose or action terms
- clothing terms
- body or expression terms
- background or setting terms
- lighting or mood terms
- artist or source terms
- model or technical meta terms
- likely near-duplicate variants
- same-family clusters

This should work even when the user has not manually created prompt groups.

## Non-Goals For The First Wave
Out of scope for the first automatic taxonomy wave:
- requiring users to manually curate every prompt family first
- introducing PostgreSQL, pgvector, Qdrant, or Neo4j
- GPU-dependent inference in the main serving path
- replacing the existing co-occurrence graph
- perfect semantic understanding across every niche tag set
- a giant all-at-once unexplained graph dump

## Recommended System Shape
Keep the current SQLite-backed relation layer and add a second automatic analysis layer.

### Layer A: usage relations
Keep the current co-occurrence graph as a first-class graph mode.

### Layer B: automatic taxonomy and semantic relations
Add a new analysis path that derives:
- inferred type per term
- semantic family or cluster id
- similarity or family relations between terms
- optional canonical form or representative label for a cluster

The taxonomy layer should be built offline or on-demand through rebuild jobs, not in the hot path of every request.

## Data Model Direction
### 1. `prompt_term_analysis`
Stores one analyzed term record.

Suggested fields:
- `id`
- `prompt_type`
- `prompt`
- `normalized_prompt`
- `inferred_type`
- `subtype`
- `cluster_id`
- `canonical_prompt`
- `token_count`
- `has_weight_syntax`
- `is_meta`
- `analysis_version`
- `updated_at`

### 2. `prompt_term_similarity_relations`
Stores non-co-occurrence relation edges.

Suggested fields:
- `id`
- `prompt_type`
- `source_prompt`
- `target_prompt`
- `relation_kind`
- `score`
- `evidence_json`
- `created_at`
- `updated_at`

Suggested `relation_kind` values:
- `same_family`
- `string_variant`
- `semantic_neighbor`
- `type_neighbor`
- `possible_duplicate`

### 3. optional `prompt_term_clusters`
Stores cluster-level labels.

Suggested fields:
- `cluster_id`
- `prompt_type`
- `cluster_label`
- `inferred_type`
- `member_count`
- `updated_at`

## Analysis Strategy
### Phase 1, low-risk automatic classification
Use deterministic heuristics plus lightweight similarity.

Signals:
- normalized token text
- token count
- punctuation and weighting syntax
- known lexical patterns
- prefix and suffix signals
- singular or plural variation
- substring overlap
- token overlap
- current co-occurrence neighborhoods
- usage distribution patterns

This phase should not require embeddings.

### Phase 2, family clustering
Build families using a blended score from:
- string similarity
- token overlap
- shared co-occurrence neighborhood similarity
- inferred type compatibility
- optional synonym or alias detection

This should produce cluster ids and same-family edges.

### Phase 3, optional semantic enhancement
If needed later, add an optional offline embedding step for cluster refinement only.
This should remain optional and separate from the serving path.

## Inferred Type Strategy
The first automatic type classifier should be heuristic and transparent.

Candidate type labels:
- `quality`
- `subject`
- `count_or_composition`
- `pose_or_action`
- `body_or_expression`
- `hair_or_face`
- `clothing_or_accessory`
- `background_or_setting`
- `lighting_or_mood`
- `style`
- `artist_or_source`
- `meta_or_technical`
- `unknown`

The classifier should be versioned so it can be rebuilt safely after rule changes.

## Similarity Strategy
For the first automatic taxonomy wave, do not call everything semantic similarity.
Separate relation meanings.

Suggested scoring components:
- normalized string similarity
- token overlap ratio
- common-neighbor overlap inside co-occurrence graph
- inferred type match bonus
- near-duplicate penalty or boost based on shape
- popularity dampening so globally common terms do not dominate every family

This allows relationships like:
- same family without high co-usage
- same inferred type without being duplicates
- possible variant even when user prompt order differs

## API Surface
Keep graph modes explicit.

### Existing usage graph
- `GET /api/prompt-collection/graph`
  - current co-occurrence graph

### New taxonomy APIs
- `GET /api/prompt-collection/taxonomy-graph`
  - returns inferred-type and same-family graph data
- `GET /api/prompt-collection/term-analysis`
  - query one term and return inferred type, cluster, nearby family, and evidence
- `POST /api/prompt-collection/rebuild-taxonomy`
  - rebuild automatic analysis tables

Optional later:
- `GET /api/prompt-collection/clusters`
- `GET /api/prompt-collection/type-groups`

## UI Direction
### Prompt page graph tab
The graph tab should support mode switching such as:
- `Usage`
- `Taxonomy`

### Taxonomy graph presentation
This graph should prioritize:
- visible cluster grouping
- simple points and lines at low zoom
- labels only when zoomed in or when selected
- clear separation between relation kinds

### Supporting panels
When one term is selected, show compact structured details:
- inferred type
- cluster label
- nearby same-family terms
- often-used-with terms
- likely variants

No helper subtitles after titles.
Keep surfaces compact and functional.

## Delivery Plan
### Track 1, plan and contracts
- write this plan document
- define relation meanings clearly
- decide exact first-wave tables and route contracts

### Track 2, analysis foundation
- add migration for automatic taxonomy tables
- add service layer for analysis results and rebuilds
- keep this fully separate from current co-occurrence writes at first

### Track 3, first automatic classifier
- implement heuristic inferred type assignment
- implement family scoring from string and neighborhood similarity
- persist cluster ids and same-family edges

### Track 4, first UI surface
- add a `Taxonomy` graph mode in the existing graph tab or adjacent mode control
- keep the current usage graph intact
- show cluster-friendly layout and selected-term detail panel

## Recommended First Implementation Slice
To avoid tangling the current graph again, the first slice should be data-first.

### Slice 1
1. land this document
2. add backend schema for taxonomy analysis tables
3. add backend rebuild service that produces inferred types and same-family edges
4. add one backend query route for taxonomy graph
5. stop before large frontend redesign unless the backend results look sane

This gives a reviewable checkpoint before further UI work.

## Verification Plan
For the first slice:
- `npm run build:backend`
- verify rebuild completes on real prompt data
- inspect example clusters for common terms
- confirm broad meta tags do not dominate every family

For later UI slices:
- `npm run build:frontend`
- inspect graph tab behavior on desktop and mobile
- confirm zoom state is preserved
- confirm labels only appear at intended zoom levels

## Key Risks
### 1. Meta tag dominance
Very common terms can collapse the graph into one noisy mass.
Mitigation:
- classify meta or quality terms early
- optionally down-weight them in taxonomy clustering

### 2. False semantic grouping
String similarity alone can over-group unrelated tags.
Mitigation:
- require multi-signal agreement
- keep evidence per edge for debugging

### 3. UI overload
Even a better taxonomy graph can become unreadable if everything is shown at once.
Mitigation:
- cluster-aware layout
- type filtering
- edge-kind filtering
- capped result sizes

## Success Criteria
1. CoNAI keeps the existing usage graph intact.
2. CoNAI can also build an automatic taxonomy graph without manual prompt grouping.
3. Prompt terms receive useful inferred types for common cases.
4. Same-family clusters are meaningfully better than raw co-occurrence for exploration.
5. The first wave stays SQLite-backed and low-risk.
6. The frontend can grow from a safer backend foundation instead of guessing graph meaning in the UI.
