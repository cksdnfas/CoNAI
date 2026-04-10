# Refactor Wave 3 Plan, 2026-04-10

## Goal
Continue the maintainability pass on the remaining oversized files, focusing on clear ownership boundaries without over-fragmenting the codebase.

## Working Rules
- Keep behavior unchanged unless a small safety fix is required to complete the refactor.
- Prefer a few domain-shaped modules over many tiny helper files.
- Keep entry files readable and searchable.
- Reuse existing nouns and patterns from the current codebase.
- Do not introduce speculative abstraction layers.
- Verify every track with the relevant build.

## Success Criteria
1. Each target file has fewer mixed concerns than before.
2. New modules have clear, durable ownership.
3. The resulting structure remains easy to scan for future feature work.
4. Frontend tracks pass `npm run build` in `frontend`.
5. Backend tracks pass `npm run build` in `backend`.

## Wave 3 Targets

### A. `frontend/src/lib/api-image-generation.ts`
Problem:
- A single API client file now holds multiple generation-related domains: workflows, ComfyUI servers, custom dropdown lists, generation requests, cost estimation, and history.

Refactor direction:
- Keep a small shared request helper.
- Split the API surface into a few domain-based modules that match how the frontend already thinks about the feature.
- Avoid splitting every endpoint into its own file.

Expected result:
- Generation API calls become easier to find by domain.
- Changes to one generation area do not require scrolling through one giant registry file.

### B. `backend/src/models/Image/ImageSimilarityModel.ts`
Problem:
- The model still mixes threshold/weight normalization, candidate-query building, duplicate search, hybrid similarity scoring, and result assembly.

Refactor direction:
- Keep `ImageSimilarityModel` as the public entry point.
- Extract stable helper modules for query/scoring responsibilities only where the boundaries are already visible.
- Avoid turning the model into a generic framework.

Expected result:
- The model reads more like an orchestration layer.
- Similarity query/scoring logic becomes easier to change safely.

### C. `frontend/src/features/module-graph/components/module-workflow-output-management-panel.tsx`
Problem:
- The panel still mixes browse-tab coordination, artifact-preview preparation, selection actions, and output/media shaping.

Refactor direction:
- Keep the panel as the screen-level coordinator.
- Extract stable artifact/output helper logic or tightly related sub-areas only.
- Avoid splitting tiny components that always change together.

Expected result:
- The panel becomes easier to scan.
- Artifact/output preparation logic becomes easier to reuse and maintain.

## Parallelization Plan
- Tracks A, B, and C can run in parallel because they target separate frontend/backend areas.

## Verification Plan
- Track A: `frontend npm run build`
- Track B: `backend npm run build`
- Track C: `frontend npm run build`
- After merge: rerun both frontend and backend builds from the parent session.
