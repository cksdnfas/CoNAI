# CoNAI Core Refactoring Plan

## Scope

This document defines a practical refactoring plan for oversized and multi-role files in CoNAI.

The goal is not to rewrite the codebase. The goal is to reduce maintenance risk by splitting the worst files into clearer units with smaller responsibilities.

### Included scope

- backend files above roughly 700 lines
- frontend files above roughly 700 lines
- smaller files that still carry too many responsibilities
- route, service, model, and page-level orchestration surfaces that have become hard to evolve safely

### Explicit exclusions

The following areas are excluded from this plan for now:

- `frontend/src/features/image-editor/**`
- temporary reference material such as `tmp/**`
- build artifacts such as `build-output/**`, `dist/**`, and bundled files
- generated migration output files

This plan focuses on production source files only.

## Why this work is needed

Several files now act as both:

- a public API surface and
- the main implementation body for multiple workflows.

That creates these problems:

1. higher regression risk when adding features
2. slower code review because unrelated logic is mixed together
3. weak ownership boundaries between route, service, query, and UI orchestration layers
4. duplicate business rules because responsibilities are not clearly placed
5. harder testing because behavior is trapped inside large procedural files

## Refactoring rules

These rules should govern every step in this plan:

1. **No behavior rewrite unless explicitly required**
   - Prefer structure-only refactors first.
   - Preserve request contracts, DB contracts, and UI behavior.

2. **Move orchestration before changing logic**
   - Extract flows into dedicated services or hooks.
   - Keep route files and page files thinner.

3. **Prefer one responsibility boundary per step**
   - Do not split five concerns at once.
   - One phase should create one clear boundary.

4. **Keep commit slices reviewable**
   - One refactor theme per commit.
   - Do not mix unrelated cleanup.

5. **Verify after each slice**
   - backend: `npm run build`
   - frontend: `npm run build`
   - targeted runtime checks where the touched flow is user-facing

## Priority inventory

### Tier 1: highest value and highest risk concentration

#### Backend

1. `backend/src/database/userSettingsDb.ts`
   - current role mix:
     - unified user DB bootstrap
     - legacy DB migration
     - attached DB management
     - schema/index ensure logic
     - user settings persistence support
   - target direction:
     - `bootstrap/`
     - `migrations/`
     - `schema/`
     - smaller repository or gateway modules

2. `backend/src/index.ts`
   - current role mix:
     - environment bootstrap
     - security and middleware setup
     - route registration
     - database initialization
     - background service startup
     - HTTP/HTTPS server startup
   - target direction:
     - `config/bootstrap-env`
     - `app/createExpressApp`
     - `app/configureMiddleware`
     - `app/registerRoutes`
     - `startup/initializeRuntime`
     - `startup/startServer`

#### Frontend

3. `frontend/src/features/module-graph/module-graph-page.tsx`
   - current role mix:
     - graph editor state
     - load/save workflow state
     - execution state
     - validation state
     - panel orchestration
     - unsaved-change guards
   - target direction:
     - page shell
     - editor state hook
     - execution hook
     - validation hook
     - panel composition layer

4. `frontend/src/features/image-generation/components/nai-generation-panel.tsx`
   - current role mix:
     - NovelAI auth state
     - generation form state
     - image attachment state
     - asset save flows
     - module save flows
     - generation and upscale actions
     - modal orchestration
   - target direction:
     - auth section
     - generation form section
     - asset management section
     - async action hooks
     - modal state hook

### Tier 2: important domain restructuring

#### Backend

5. `backend/src/models/Image/MediaMetadataModel.ts`
   - current role mix:
     - create/update/delete
     - list queries
     - joined file queries
     - search support
     - stats support
   - target direction:
     - metadata repository
     - list/query repository
     - stats query module

6. `backend/src/models/Image/ImageSearchModel.ts`
7. `backend/src/services/autoTagSearchService.ts`
8. `backend/src/services/complexFilterService.ts`
   - these three should be treated as one search-stack refactor track
   - target direction:
     - shared query fragments
     - search input normalization
     - dedicated query builders by concern
     - thinner search entrypoints

9. `backend/src/services/fileWatcherService.ts`
   - current role mix:
     - watcher registry
     - retry lifecycle
     - debounce and queueing
     - DB status sync
     - file event routing
     - scan trigger behavior
   - target direction:
     - registry/lifecycle module
     - event scheduling module
     - DB synchronization module
     - watcher runtime facade

### Tier 3: smaller but still overloaded surfaces

10. `backend/src/routes/images/management.routes.ts`
    - route should stop owning metadata rewrite orchestration
    - target direction:
      - route validates request and maps response only
      - service owns download/save orchestration

11. `frontend/src/features/groups/group-page.tsx`
    - split tree navigation, selection/download state, and page composition

12. `frontend/src/features/image-generation/components/wildcard-generation-panel.tsx`
    - split workspace-tab policy, tree logic, CRUD mutations, and modal orchestration

## Recommended execution order

This order balances impact, blast radius, and current implementation safety.

### Phase 1: establish the refactoring pattern on a constrained surface

Start with:

- `backend/src/routes/images/management.routes.ts`

Reason:

- smaller than the top-tier files
- still clearly overloaded
- limited blast radius
- already tied to a recent feature boundary
- useful as a pattern for later route-to-service extraction

Expected result:

- introduce a dedicated image metadata edit orchestration service
- keep the route thin
- preserve existing API behavior

### Phase 2: split backend startup boundaries

Then move to:

- `backend/src/index.ts`

Expected result:

- a dedicated app-construction path
- route registration extracted from process/bootstrap concerns
- easier startup testing and lower merge conflict risk

### Phase 3: isolate DB bootstrap and migration responsibilities

Then move to:

- `backend/src/database/userSettingsDb.ts`

Expected result:

- legacy migration isolated from normal runtime initialization
- smaller schema/bootstrap modules
- clearer upgrade path for future DB changes

### Phase 4: refactor the search stack as one track

Group these together:

- `backend/src/models/Image/ImageSearchModel.ts`
- `backend/src/services/autoTagSearchService.ts`
- `backend/src/services/complexFilterService.ts`
- related shared SQL helpers

Expected result:

- one shared search architecture instead of overlapping query builders
- reduced duplication in SQL condition assembly
- better testability of search rules

### Phase 5: split major frontend orchestration pages

Order:

1. `frontend/src/features/module-graph/module-graph-page.tsx`
2. `frontend/src/features/image-generation/components/nai-generation-panel.tsx`
3. `frontend/src/features/groups/group-page.tsx`
4. `frontend/src/features/image-generation/components/wildcard-generation-panel.tsx`

Expected result:

- page shells stay declarative
- stateful logic moves into hooks and section components
- UI work stops accumulating inside single files

## First implementation slice

### Target

`backend/src/routes/images/management.routes.ts`

### Why this is the first slice

At the time of this plan, several higher-priority files already have unrelated in-progress changes in the working tree. This route is a safer first extraction target because it allows meaningful progress without colliding with unrelated database/bootstrap edits.

### Slice goal

Create a dedicated service for image metadata edit orchestration that owns:

- editable-target resolution
- metadata patch validation
- output format resolution
- metadata download preparation
- metadata save orchestration
- replacement file staging and cleanup policy
- revision record creation

The route should keep only:

- route parameter validation
- HTTP status mapping
- response formatting

### Out of scope for the first slice

- changing metadata file format behavior
- restore API work
- revision list UI
- changing database schema again

## Success criteria by track

### Route/service refactors

Success means:

- route files mostly map HTTP to service calls
- service files own orchestration
- existing API behavior remains unchanged

### Model/search refactors

Success means:

- query-building responsibility is explicit
- stats, mutations, and list queries are not mixed in one file
- shared SQL fragments are reused instead of duplicated

### Frontend page refactors

Success means:

- pages become composition shells
- state and async orchestration move into hooks
- reusable sections have stable props and boundaries

## Commit discipline

When this plan is executed:

- use small reviewable commits
- do not mix unrelated dirty-worktree files into refactor commits
- when the working tree already contains unrelated changes, commit only the touched plan files and the target refactor slice

## Verification checklist

For every phase:

1. inspect the current file and name its mixed responsibilities
2. define the new boundary before editing
3. move code without changing behavior where possible
4. run build verification
5. do one targeted runtime sanity check if the flow is user-facing
6. document any deferred follow-up instead of expanding scope mid-change

## Current decision

Proceed with **Phase 1** first:

- document the plan in `docs/Work_Plan/CORE_REFACTORING_PLAN.md`
- extract the image metadata edit orchestration out of `management.routes.ts`
- verify backend build after the extraction

Later phases should follow this document instead of opening multiple large-file refactors at once.
