# Image List Architecture Research — Masonic + React Selecto

Date: 2026-03-21
Project: CoNAI frontend

## Decision Summary

For CoNAI, the image list must support very large collections. Some users may manage **tens of thousands of images**, so the list architecture must prioritize virtualization, scalable rendering, and durable selection state.

**Decision:**
- Use `masonic` as the image list rendering engine.
- Use `react-selecto` as the drag-selection layer.
- Keep the source of truth for selection in React state (`selectedIds`), not in the DOM.

This combination is acceptable for CoNAI, but it comes with important constraints.

---

## Why `masonic`

`masonic` is a virtualized masonry grid for React.

Key reasons for selection:
- Designed for large datasets.
- Officially supports virtualization for tens of thousands of items.
- Supports autosizing cells.
- Exposes low-level hooks and callbacks for advanced composition.
- Includes an official infinite loading utility (`useInfiniteLoader`).

Observed package facts during research:
- package: `masonic`
- version reviewed: `4.1.0`
- unpacked size observed from npm metadata: ~862 KB
- npm metadata last modified observed: `2025-04-22`

Relevant capabilities confirmed from docs/README/npm:
- `Masonry` component for autosizing masonry grids.
- `List` component for single-column virtualized lists.
- `useInfiniteLoader()` for infinite scrolling.
- `itemKey` support for stable identity.
- `overscanBy` tuning for virtualization behavior.

---

## Why `react-selecto`

`react-selecto` is a DOM-based drag selection library for React.

Key reasons for selection:
- It is light enough to add as a focused interaction layer.
- It works by selecting currently rendered DOM elements.
- It gives direct control over target selectors and selection behavior.

Observed package facts during research:
- package: `react-selecto`
- version reviewed: `1.26.3`
- unpacked size observed from npm metadata: ~41 KB
- npm metadata last modified observed: `2023-12-03`

---

## Critical Constraint: Virtualization vs. Drag Selection

This is the most important architectural rule.

`masonic` virtualizes items, which means off-screen items are not mounted in the DOM.
`react-selecto` selects DOM nodes that currently exist.

Therefore:
- Drag selection works well for **currently rendered / visible items**.
- Drag selection does **not** magically select items that are not mounted.
- Selection state must be persisted in application state, not inferred from current DOM classes.

### Practical implication
The system must treat drag selection as a **visible-range selection input**, not as the full selection model.

That means CoNAI should support this long-term pattern:
- visible drag selection
- click selection
- shift-range selection (future)
- select all filtered results (future)
- bulk actions driven by `selectedIds`

---

## Infinite Scroll Support

`masonic` does support infinite scrolling.

Confirmed from official docs/README:
- `useInfiniteLoader()` is provided for infinite loading behavior.
- `onRender(startIndex, stopIndex, items)` can also be used to trigger fetches.

Recommended CoNAI integration:
- use React Query `useInfiniteQuery()` for server paging
- flatten loaded pages into a single image array
- wire `masonic` render progress to `fetchNextPage()`

This approach is appropriate for very large image collections.

---

## Fixed-Size Grid Support

This point needs careful wording.

`masonic` is primarily a **masonry** engine.
It is excellent for variable-height image layouts.

It can still render a visually uniform grid if item dimensions are constrained in the render component, but it is not a dedicated fixed-size grid library.

Conclusion:
- `masonic` is a strong fit for CoNAI's masonry / image feed mode.
- It can approximate uniform card layouts if needed.
- If a future page requires a strict fixed-size management grid, that may deserve a separate rendering mode later.

For now, using `masonic` as the primary engine is still the correct decision.

---

## Recommended Architecture

### Source of truth
- `items`: fetched image records
- `selectedIds`: React state
- `itemKey`: stable image identity (`composite_hash` or fallback id)

### Rendering responsibilities
- `image-list` module owns the rendering engine abstraction.
- Current engine: `masonic`
- Future engine swap should be isolated to the image-list module.

### Selection responsibilities
- `react-selecto` only handles drag hit-testing for rendered items.
- The image list converts selected DOM nodes into image ids.
- The parent page stores and consumes `selectedIds`.

---

## Implementation Notes for CoNAI

1. The image list module must be reusable across:
   - Home
   - Groups
   - Search results
   - Upload result flows
   - Related-image views

2. Every rendered item must expose a stable DOM attribute such as:
   - `data-image-id`

3. The list module must accept reusable props such as:
   - `items`
   - `getItemHref`
   - `selectable`
   - `selectedIds`
   - `onSelectedIdsChange`
   - `hasMore`
   - `isLoadingMore`
   - `onLoadMore`

4. Home should use the reusable list module instead of owning masonry logic directly.

---

## Final Conclusion

For CoNAI, **`masonic + react-selecto` is the correct direction** because the scale requirement is large enough that lightweight non-virtualized masonry libraries are no longer the right default.

However, success depends on one architectural rule:

> Treat drag selection as an input mechanism for visible items, while keeping selection state in application state.

As long as that rule is followed, this combination is viable and future-proof enough for the next phase of CoNAI frontend development.
