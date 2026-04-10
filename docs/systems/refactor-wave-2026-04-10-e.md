# Refactor Wave 5 Plan, 2026-04-10

## Goal
Continue the maintainability pass on the next set of high-value large files, keeping behavior stable while reducing responsibility overload.

## Working Rules
- Keep behavior unchanged unless a very small safety fix is required to complete the refactor.
- Prefer a few domain-shaped modules over many tiny files.
- Keep entry files easy to find and easy to scan.
- Reuse existing naming and utility patterns.
- Avoid speculative abstraction, generic frameworks, and hook mazes.
- Verify each track with the relevant build.

## Success Criteria
1. Each target file reads more like orchestration and less like a single large implementation block.
2. New modules have clear ownership and durable boundaries.
3. The resulting structure stays easy to search and extend.
4. Frontend tracks pass `npm run build` in `frontend`.
5. Backend tracks pass `npm run build` in `backend`.

## Wave 5 Targets

### A. `frontend/src/features/wallpaper/wallpaper-easing-picker.tsx`
Problem:
- One file mixes storage, import/export, rename/pin management, graph interaction, preview rendering, and the picker modal UI.

Refactor direction:
- Keep `WallpaperEasingPicker` as the entry component.
- Extract stable preset-management logic and strongly bounded preview/graph UI pieces only where the boundaries are already obvious.
- Do not split into tiny one-purpose files.

Expected result:
- The picker stays easy to find.
- Preset management and graph/preview responsibilities become easier to maintain.

### B. `backend/src/services/fileWatcherService.ts`
Problem:
- The service mixes watcher lifecycle, folder registration sync, event routing, debounce/retry behavior, and scan orchestration.

Refactor direction:
- Keep `fileWatcherService` as the public service entry.
- Extract helper responsibilities only where the boundaries are already explicit.
- Do not introduce a new framework.

Expected result:
- Watcher lifecycle and scan orchestration become easier to read.
- Future watcher behavior changes become safer.

### C. `frontend/src/features/images/image-detail-view.tsx`
Problem:
- The file still mixes page-level orchestration, similar-image logic, score-overlay behavior, popup state, and detail rendering glue.

Refactor direction:
- Keep the image detail view as the page-level entry.
- Extract stable similarity/overlay/popup subareas or helper logic where those boundaries are already visible.
- Avoid scattering the page into many tiny files.

Expected result:
- The page becomes easier to scan.
- Similarity UI behavior becomes easier to adjust safely.

## Parallelization Plan
- Tracks A, B, and C can run in parallel because they touch separate frontend/backend areas.

## Verification Plan
- Track A: `frontend npm run build`
- Track B: `backend npm run build`
- Track C: `frontend npm run build`
- After merge: rerun frontend and backend builds from the parent session.
