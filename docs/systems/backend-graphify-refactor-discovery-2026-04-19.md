# Backend Graphify Refactor Discovery (2026-04-19)

## Snapshot

- Repository snapshot commit: `4931c00` (`chore: snapshot worktree before backend refactor planning`)
- Scope analyzed: `backend/` with frontend impact review
- Primary goal: identify low-risk, high-value refactor candidates for backend duplication cleanup without breaking connected frontend flows

## How Graphify Was Used

### Inputs

- Existing project graph: `graphify-out/graph.json`
- Existing report: `graphify-out/GRAPH_REPORT.md`
- Backend-focused detection pass on `backend/`

### Observed Graph State

- Full project graph: `4368` nodes, `7349` edges
- Dominant relations in the current graph:
  - `calls`: `3762`
  - `contains`: `2402`
  - `method`: `1176`
  - `rationale_for`: `9`
- Backend-focused corpus detection:
  - `365` supported files
  - `347` code files
  - `2` document files
  - `16` image files
  - about `249,039` words
  - `2` sensitive files skipped

### Efficiency Check

Graphify was useful in this phase because it narrowed the search space before manual inspection.

- Full-corpus benchmark result: about `53.6x` token reduction
- Practical effect in this review:
  - avoided reading the entire backend sequentially
  - highlighted route, service, and helper clusters quickly
  - provided a persistent map that can be reused for later passes

### Current Limitation

The current graph is strong for structural analysis and clustering, but weaker for high-confidence semantic deduplication because the existing graph is dominated by structural edges. That means the current pass is best used for:

- duplication candidate discovery
- route/service/helper clustering
- identifying likely consolidation zones

It is not enough by itself to prove that two implementations are semantically interchangeable.

## High-Confidence Refactor Candidate Areas

### 1. Settings route layer

Files:

- `backend/src/routes/settings.ts`
- `backend/src/routes/settings/appearance.routes.ts`
- `backend/src/routes/settings/media-settings.routes.ts`
- `backend/src/routes/runtimeAppearance.routes.ts`
- `backend/src/routes/runtime-media-settings.routes.ts`

Why this cluster matters:

- validation logic is repeated
- response formatting is inconsistent across related settings endpoints
- runtime read endpoints and mutable settings endpoints are split across several files with overlapping domain ownership

Risk to frontend:

- high
- frontend references to settings-related APIs appear broad, so route shapes and response contracts must remain stable

### 2. Image route helper layer

Files:

- `backend/src/routes/images/query-file-helpers.ts`
- `backend/src/routes/images/query-list-helpers.ts`
- `backend/src/routes/images/similarity-route-helpers.ts`
- `backend/src/routes/images/uploadRouteHelpers.ts`
- `backend/src/routes/images/utils.ts`

Why this cluster matters:

- parsing helpers, guard helpers, enrichment helpers, and fallback helpers are distributed across multiple route helper files
- there are multiple small utilities that solve adjacent problems with inconsistent placement
- image APIs are frontend-sensitive, so internal cleanup must preserve current payload shapes

Risk to frontend:

- high
- image-related client APIs are widely referenced

### 3. Repeated validation and 400-response boilerplate

Representative files:

- `backend/src/routes/graphWorkflows.ts`
- `backend/src/routes/generation-queue.routes.ts`
- `backend/src/routes/auth.routes.ts`
- `backend/src/routes/settings.ts`
- `backend/src/routes/settings/media-settings.routes.ts`
- `backend/src/routes/images/tagging.mutation.routes.ts`

Why this cluster matters:

- repeated `res.status(400).json({ success: false, error: ... })`
- repeated enum validation
- repeated numeric range validation
- repeated positive integer parsing and fallback behavior

Risk to frontend:

- low to medium if response shape is preserved

### 4. Route composition duplication patterns

Representative files:

- `backend/src/routes/groups.ts`
- `backend/src/routes/wildcards.ts`
- `backend/src/routes/images/tagging.routes.ts`
- `backend/src/routes/workflows/index.ts`

Why this cluster matters:

- read/mutation/utility composition patterns are repeated with slightly different organization rules
- maintainability cost rises as each domain evolves its own route assembly style

Risk to frontend:

- medium
- route paths are stable today, but route grouping changes could create integration mistakes if done too aggressively

## Priority Recommendation

## Priority 1

Build a shared backend route validation and response foundation, then adopt it first in the settings layer and selected image helper paths.

Why this should go first:

- high reuse potential
- low-risk if API contracts stay unchanged
- creates a common base before larger route consolidation
- supports safe parallel follow-up work across settings and images

## Guardrails

- do not change route URLs
- do not change response JSON shape unless explicitly approved
- keep request field names stable
- prefer internal helper extraction before moving route ownership boundaries
- verify frontend-sensitive surfaces before and after each adoption step

## Suggested Refactor Sequence

1. Create shared route validation helpers and shared error-response helpers
2. Apply them to one backend settings slice with no API contract changes
3. Apply the same helpers to one image helper slice with no API contract changes
4. Only after the shared foundation is proven, start larger settings/image consolidation

## Recommended Next Documents

- `backend-priority1-route-foundation-plan.md`
- `backend-priority1-route-foundation-todo.md`
