# Refactor Wave Plan, 2026-04-10

## Goal
Improve maintainability and extension safety in a few oversized files without over-fragmenting the codebase.

## Working Rules
- Keep behavior unchanged unless a tiny fix is required to complete the refactor safely.
- Prefer a few clear modules over many tiny files.
- Extract only responsibility boundaries that are already visible in the current code.
- Preserve existing naming patterns and UI/backend behavior.
- Add short English comments only where they improve searchability or explain a new helper role.
- Verify each refactor with the relevant build step.

## Success Criteria
1. Each target file has fewer mixed responsibilities than before.
2. New modules have obvious ownership and searchable names.
3. No speculative abstraction layer is introduced.
4. Frontend changes pass `npm run build` in `frontend`.
5. Backend changes pass `npm run build` in `backend`.

## Wave 1 Targets

### A. `frontend/src/features/wallpaper/wallpaper-widget-bodies.tsx`
Problem:
- One file mixes shared preview rendering, transition logic, collage math, and multiple widget body implementations.

Refactor direction:
- Keep `WallpaperWidgetBody` as the top-level entry point.
- Extract shared preview/media surface logic into one helper module.
- Extract image-heavy widget bodies into a small module group with clear names.
- Do not split every widget into its own file unless the boundary is already strong.

Expected result:
- The main file becomes an orchestration layer plus a few small widget bodies.
- Shared preview/media behavior is easier to reuse and update.

### B. `frontend/src/features/image-generation/components/comfy-workflow-authoring-modal.tsx`
Problem:
- The file mixes modal state, workflow JSON parsing, graph conversion, graph search behavior, and field editing flows.

Refactor direction:
- Keep the modal component as the screen-level orchestrator.
- Extract workflow parsing / graph-building helpers into one or two focused modules.
- Extract the marked-field editing section if it reduces branching without scattering logic.
- Avoid creating a large hook matrix.

Expected result:
- The modal stays readable.
- Parsing/layout/search support code becomes easier to test and reason about.

### C. `backend/src/services/graph-workflow-executor/execute-system.ts`
Problem:
- The file mixes input normalization, prompt/image lookup helpers, and many system-operation execution paths.

Refactor direction:
- Keep the top-level system execution entry in the current area.
- Extract operation-family helpers into a small set of modules by responsibility.
- Reuse the shared execution context and logging flow rather than introducing a new execution framework.
- Keep the registry simple and explicit.

Expected result:
- Adding a new system operation no longer requires touching one giant file.
- Operation-specific logic is easier to scan and maintain.

### D. `frontend/src/features/settings/settings-page.tsx`
Problem:
- The page mixes data fetching, mutation wiring, draft state, validation, and tab orchestration.

Refactor direction:
- Keep the page as the composition root.
- Extract query/mutation wiring or tab-specific draft handling only where the boundary is already stable.
- Avoid over-abstracting tabs that change together frequently.

Expected result:
- The page reads like a coordinator instead of a full implementation dump.

## Parallelization Plan
- Track A, B, and C can run in parallel because they touch separate files and separate feature areas.
- Track D can start after the first wave if bandwidth remains, or can be done in parallel if the working tree stays clean.

## Verification Plan
- After each track, run the relevant build.
- After merge, run both frontend and backend builds again.
- If a refactor unexpectedly changes behavior, reduce scope rather than adding more abstraction.
