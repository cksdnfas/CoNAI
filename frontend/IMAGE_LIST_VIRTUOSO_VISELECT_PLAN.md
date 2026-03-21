# Image List Migration Plan — Virtuoso + ViSelect

Date: 2026-03-21
Project: CoNAI frontend

## Goal
Replace the current `masonic + react-selecto` image list implementation with a reusable, modular image list engine based on:
- `react-virtuoso`
- `@virtuoso.dev/masonry`
- `@viselect/vanilla`

This engine must be reusable across:
- Home
- Group image listings
- Search results
- Upload result flows
- Future related-image views

## Why the migration is necessary
The old implementation suffered from the following issues:
- video previews were too sensitive to selection-related re-rendering
- drag selection behavior caused unstable visual feedback during heavy media rendering
- the list engine was drifting toward a Home-specific implementation instead of a reusable module

## Architectural decision
### Rendering
- `grid` mode: `VirtuosoGrid`
- `masonry` mode: `VirtuosoMasonry`

### Selection
- Use `@viselect/vanilla`
- During drag, selection preview must be DOM-driven
- After drag ends, only the final selected ids are committed into React state

### General module boundary
The `image-list` feature owns:
- rendering mode selection
- selection engine wiring
- load-more trigger
- stable item identity

Page features such as Home only provide:
- data
- route hrefs
- load-more callbacks
- selected id state

## Supported modes in phase 1
- `layout: "masonry"`
- `layout: "grid"`
- image / gif / video mixed media support
- infinite loading
- drag selection
- bottom selection action bar

## Explicit non-goals in phase 1
- complex Pinterest-grade visual polish
- page-specific list engines
- bulk move/delete flows beyond the current action slot
- premature over-configuration

## Success criteria
A successful migration means:
1. Home uses the new Virtuoso + ViSelect image list.
2. The list supports both grid and masonry modes.
3. Drag selection preview no longer relies on per-frame React state updates.
4. Image list code is reusable by future Group/Search pages.
5. `masonic` and `react-selecto` are removed from dependencies and runtime usage.
6. The frontend builds and lints successfully.
