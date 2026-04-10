# Refactor Wave 4 Plan, 2026-04-10

## Goal
Continue the maintainability pass on remaining high-priority large files, focusing on strong responsibility boundaries without scattering the codebase into tiny modules.

## Working Rules
- Keep runtime behavior unchanged unless a very small safety fix is required.
- Prefer a few durable, domain-shaped modules over one-file-per-widget or one-file-per-endpoint fragmentation.
- Keep entry files readable and easy to search.
- Reuse existing names, utilities, and patterns.
- Avoid speculative abstraction and avoid hook mazes.
- Verify each track with the relevant build.

## Success Criteria
1. Each target file reads more like orchestration and less like one giant implementation block.
2. New modules have clear ownership and stable boundaries.
3. The resulting structure is still easy to scan for future work.
4. Frontend tracks pass `npm run build` in `frontend`.
5. Backend tracks pass `npm run build` in `backend`.

## Wave 4 Targets

### A. `frontend/src/features/wallpaper/wallpaper-widget-inspector-editors.tsx`
Problem:
- The extracted widget-specific editor file is still very large and contains multiple widget families with repeated subsection and control patterns.

Refactor direction:
- Keep the current editor module as the entry for widget-specific editors.
- Extract only strong family boundaries or shared subsection helpers where those patterns already exist.
- Avoid splitting into one file per widget.

Expected result:
- Widget-specific editor logic becomes easier to extend.
- Repeated editor subsection patterns become easier to maintain.

### B. `frontend/src/features/image-generation/components/wildcard-inline-picker-field.tsx`
Problem:
- One file mixes local storage persistence, wildcard flattening/query resolution, insertion behavior, explorer tree state, and the full picker UI.

Refactor direction:
- Keep the field component as the screen-level entry point.
- Extract stable query/persistence helpers and strongly bounded explorer UI pieces only.
- Preserve the current wildcard behavior exactly.

Expected result:
- The main component becomes easier to follow.
- Wildcard matching/insertion helpers become easier to reason about and reuse.

### C. `backend/src/services/customNodeRegistryService.ts`
Problem:
- The service has grown to mix registry loading, normalization, validation, persistence, and related orchestration.

Refactor direction:
- Keep `customNodeRegistryService` as the public service entry.
- Extract stable helper responsibilities only where the boundaries are already explicit.
- Do not introduce a new service framework.

Expected result:
- Registry load/normalize/validate flows become easier to scan and maintain.
- Future custom-node changes are less risky.

## Parallelization Plan
- Tracks A, B, and C can run in parallel because they target separate feature areas.

## Verification Plan
- Track A: `frontend npm run build`
- Track B: `frontend npm run build`
- Track C: `backend npm run build`
- After merge: rerun frontend and backend builds from the parent session.
