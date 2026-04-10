# Refactor Wave 2 Plan, 2026-04-10

## Goal
Continue the maintainability pass after Wave 1 by targeting large files that still mix multiple responsibilities, while avoiding over-fragmentation.

## Working Rules
- Keep behavior unchanged unless a tiny safety fix is required.
- Prefer a few durable boundaries over many tiny files.
- Extract only boundaries that are already visible in the current implementation.
- Keep top-level screen and route files as orchestration roots when that improves readability.
- Reuse existing utilities and patterns before creating new ones.
- Verify every track with the relevant build.

## Success Criteria
1. Each target file reads more like a coordinator and less like a full implementation dump.
2. New modules have clear ownership and searchable names.
3. No speculative abstraction or generic framework is introduced.
4. Frontend refactors pass `npm run build` in `frontend`.
5. Backend refactors pass `npm run build` in `backend`.

## Wave 2 Targets

### A. `frontend/src/features/wallpaper/wallpaper-widget-inspector.tsx`
Problem:
- A single file still holds a long per-widget conditional editor with many type-specific settings branches.

Refactor direction:
- Keep `WallpaperWidgetInspector` as the entry component.
- Extract stable editor sections only where the boundary is already strong.
- Prefer grouping related widget editors instead of splitting every widget into its own file.
- Keep shared inspector controls close to the entry file.

Expected result:
- The main inspector file becomes easier to scan.
- Widget-specific editors become easier to extend without increasing branching pressure.

### B. `frontend/src/features/images/components/detail/image-view-modal-provider.tsx`
Problem:
- One file mixes provider state, modal shell rendering, view-mode-specific surfaces, action bars, and modal interaction behavior.

Refactor direction:
- Keep the provider/context entry in the main file if it remains the best composition root.
- Extract modal content surfaces and action areas along stable UI boundaries.
- Avoid a hook maze and avoid splitting tiny pieces that always change together.

Expected result:
- The provider stays easy to find.
- Modal rendering and mode-specific content are easier to reason about and maintain.

### C. `backend/src/routes/image-editor.routes.ts`
Problem:
- The route file still mixes route wiring, file-system traversal, conversion prep, and repeated response shaping.

Refactor direction:
- Keep the route module as the HTTP entry point.
- Extract helper logic for save-browser listing and editor-response preparation into focused helpers.
- Do not introduce a new routing framework or controller layer.

Expected result:
- The route file becomes thinner and easier to scan.
- File-system and editor-preparation logic become easier to test and reuse.

## Parallelization Plan
- Tracks A, B, and C can run in parallel because they affect separate feature areas.

## Verification Plan
- Track A: `frontend npm run build`
- Track B: `frontend npm run build`
- Track C: `backend npm run build`
- After merge: rerun both frontend and backend builds from the parent session.
