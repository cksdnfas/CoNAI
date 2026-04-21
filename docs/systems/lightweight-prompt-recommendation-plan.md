# Lightweight Prompt Recommendation Plan, 2026-04-21

## Goal
Introduce a lightweight prompt recommendation layer into CoNAI with minimal deployment risk.

This wave should improve prompt discovery and reuse without adding a new database engine, vector database, graph database, or GPU-dependent runtime.

## Product Intent
The feature should help users discover prompt terms and prompt combinations that are already working well inside the current CoNAI dataset.

Target outcomes:
- related prompt suggestions
- co-occurring tag suggestions
- prompt continuation suggestions
- lightweight similar-prompt discovery
- reusable prompt bundles based on observed usage patterns

This plan is intentionally not a semantic-embedding project.
It is a pattern-driven recommendation system built on top of CoNAI's existing prompt collection and prompt similarity foundations.

## Non-Goals For This Phase
Out of scope for the first wave:
- PostgreSQL migration
- pgvector
- Qdrant
- Neo4j
- external embedding APIs
- local embedding inference services
- GPU-dependent recommendation serving
- full concept graph visualization
- long explanatory helper copy in the UI

## Why This Shape
CoNAI already has meaningful prompt infrastructure:
- prompt ingestion from image metadata
- separate positive, negative, and auto prompt collections
- prompt group organization
- synonym management
- prompt similarity based on normalized prompt text plus simhash or minhash
- prompt search suggestions already shown in existing search flows

Because these pieces already exist, the lowest-risk expansion is to add lightweight relationship scoring on top of the current SQLite-backed prompt system.

## Current Findings
### Existing prompt ingestion
Current prompt ingestion already:
- parses positive prompts
- parses negative prompts
- parses LoRA references separately
- normalizes prompt terms
- stores prompt usage counts
- stores auto-tag derived prompt terms

Primary current files:
- `backend/src/services/promptCollectionIngestService.ts`
- `backend/src/services/promptCollectionService.ts`
- `backend/src/models/PromptCollection.ts`
- `backend/src/services/autoTagScheduler.ts`
- `backend/src/services/backgroundQueue.ts`

### Existing prompt storage
Current storage already includes:
- `prompt_collection`
- `negative_prompt_collection`
- `auto_prompt_collection`
- prompt groups and auto prompt groups
- usage counts and synonym metadata

Relevant migrations and models:
- `backend/src/database/migrations/000_create_all_tables.ts`
- `backend/src/database/migrations/006_create_auto_prompt_tables.ts`
- `backend/src/models/PromptCollection.ts`

### Existing prompt similarity
CoNAI already computes prompt similarity from normalized prompt text using:
- `simhash`
- `minhash`

This is image-centric today, not prompt-term relationship-centric.

Relevant files:
- `backend/src/services/promptSimilarityService.ts`
- `backend/src/database/migrations/011_add_prompt_similarity_fields.ts`
- `backend/src/routes/images/prompt-similarity.routes.ts`

### Existing prompt UI surfaces
Prompt-related UI already exists in:
- prompt management page
- image detail prompt similarity section
- search suggestion flow

Relevant files:
- `frontend/src/features/prompts/prompt-page.tsx`
- `frontend/src/features/prompts/components/*`
- `frontend/src/features/images/components/detail/image-detail-similarity-section.tsx`
- `frontend/src/features/search/use-search-suggestion-data.ts`
- `frontend/src/lib/api-prompts.ts`

## Recommended First-Pass Architecture
Use the current Node + SQLite application architecture.

Add one lightweight relationship layer:
- prompt co-occurrence scoring
- optional ordered-next-term scoring for continuation suggestions
- optional prompt bundle aggregation

No separate service should be introduced in this phase.

## Data Model Direction
### New tables
Add small relational tables instead of new infrastructure.

Recommended first-pass tables:

1. `prompt_term_relations`
- `id`
- `source_prompt`
- `target_prompt`
- `relation_type` (`co_occurrence` | `continuation`)
- `shared_count`
- `score`
- `last_seen_at`
- unique key on `(source_prompt, target_prompt, relation_type)`

2. `prompt_bundle_relations`
- `id`
- `anchor_prompt`
- `bundle_json`
- `bundle_size`
- `usage_count`
- `score`
- `updated_at`

3. optional `prompt_relation_rebuild_state`
- track rebuild progress and timestamps
- useful when rebuilding from all existing media metadata

### Why table-level relations instead of full graphs
This keeps the system:
- SQLite-friendly
- easy to rebuild
- easy to inspect manually
- easy to roll back
- easy to expose through existing REST routes

## Relation Building Strategy
### Source records
Build relations from normalized prompt-bearing fields already present in media metadata:
- positive prompt
- negative prompt
- auto tags
- optional character prompt text when available

### Normalization rules
Reuse current prompt normalization as much as possible.
Do not invent a second cleaning pipeline unless the existing one is clearly insufficient.

Rules:
- lowercase and whitespace normalization should stay consistent with current prompt similarity logic
- LoRA terms should stay separate from ordinary term relations in the first pass
- invalid placeholder prompts should be excluded
- duplicate terms within a single source record should be deduplicated before pair counting

### Relation types
#### A. Co-occurrence
If two prompt terms appear in the same normalized prompt set, increment the pair score.

Use cases:
- related prompt suggestions
- sibling prompt suggestions
- bundle suggestions

#### B. Continuation
If prompt order is preserved from comma-delimited user prompts, capture simple next-term patterns.

Use cases:
- prompt continuation suggestions
- type-ahead recommendations after a selected term

This should be optional in the first implementation slice if time is tight.

## Scoring Direction
### Co-occurrence score
First pass can use a simple blended score derived from:
- shared count
- source usage count
- target usage count
- normalized ratio to avoid always favoring globally popular tags

Example direction:
- keep raw `shared_count`
- compute a normalized score during rebuild or query time
- sort by `score DESC`, then `shared_count DESC`

### Continuation score
Use:
- next-term count
- positional confidence
- source term usage count

### Similar prompt results
Keep using the existing prompt similarity system for image-level prompt similarity.
Do not replace it.
Use it as a separate signal.

## Recommended API Surface
Add dedicated endpoints rather than overloading the current prompt search endpoint too aggressively.

Recommended first-pass routes:
- `GET /api/prompt-collection/related`
  - query: `prompt`, `type`, `limit`
- `GET /api/prompt-collection/continuations`
  - query: `prompt`, `type`, `limit`
- `GET /api/prompt-collection/bundles`
  - query: `prompt`, `type`, `limit`
- `POST /api/prompt-collection/rebuild-relations`
  - admin/manual rebuild trigger

The existing `/search` and `/top` routes should remain stable.

## Recommended UI Surfaces
### First-pass UI surfaces
1. Prompt search suggestion layer
- show related prompt chips after a search term is entered

2. Prompt management page
- when one prompt is selected, show related prompts and common companions

3. Generation-side prompt input surfaces
- show continuation suggestions after the current term or phrase

### UI rules for this feature
If UI is added in this wave, follow these project-specific rules:
- match the existing CoNAI visual theme and component language
- prefer existing surfaces and shared patterns over new decorative layouts
- use title + content composition by default
- do not add helper sentences, subtitles, or descriptive filler text after titles
- prefer compact actionable chips, pills, lists, or cards
- keep new UI text short and functional

## Delivery Strategy
### Track A, Data foundation
Scope:
- new migration for lightweight relation tables
- backend model/service layer for relation writes and queries
- rebuild support from existing media metadata

Expected result:
- CoNAI can store and query prompt term relations without new infrastructure.

### Track B, Ingestion integration
Scope:
- integrate relation updates into existing prompt collection flow
- ensure upload and background collection paths keep relation data in sync

Expected result:
- newly processed media gradually improves relation quality without requiring full rebuilds each time.

### Track C, Query endpoints
Scope:
- add related, continuation, and optional bundle endpoints
- keep contracts narrow and cache-friendly

Expected result:
- frontend can request recommendations without reimplementing scoring logic.

### Track D, UI adoption
Scope:
- add one or two compact surfaces first
- start with search suggestions and prompt management page before broader rollout

Expected result:
- users gain recommendation value quickly without a large UI redesign.

## Execution Order
1. Land this plan doc.
2. Add backend migration for relation tables.
3. Add backend relation service and rebuild logic.
4. Integrate relation updates into prompt collection ingestion.
5. Add related prompt query endpoint.
6. Add one compact UI surface.
7. Add continuation suggestions if the first slice lands cleanly.
8. Validate build paths.

## Verification Plan
- `npm run build:backend`
- `npm run build:frontend`
- targeted sanity checks for prompt search, prompt page, and any new recommendation surface

Note:
- This document-only step does not require a Graphify code update.
- If later implementation changes code files, run `python -m graphify update .` before the final implementation reply.

## Success Criteria
1. CoNAI can build and store lightweight prompt relations in SQLite.
2. Related prompt suggestions can be queried for one selected term.
3. Existing prompt search and prompt collection behavior stays intact.
4. No new external infrastructure is required.
5. No GPU is required for serving or rebuilding the lightweight recommendation layer.
6. Any new UI follows the existing theme and avoids title-following helper copy.

## First Implementation Slice
The first concrete slice should be:
1. migration for `prompt_term_relations`
2. rebuild logic from existing media metadata
3. one `related prompts` endpoint
4. one compact UI surface that consumes it

That slice is large enough to prove value and still small enough to ship safely.
