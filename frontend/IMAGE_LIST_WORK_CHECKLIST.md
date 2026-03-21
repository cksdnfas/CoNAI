# Image List Work Checklist

Date: 2026-03-21
Scope: CoNAI frontend image list modularization and engine integration

## Completed
- [x] Confirm scale requirement: users may manage tens of thousands of images.
- [x] Re-evaluate image list library choice based on large-scale rendering.
- [x] Research `masonic` capabilities for virtualization and infinite loading.
- [x] Research `react-selecto` suitability for drag selection.
- [x] Document the integration constraint between virtualization and DOM-based selection.
- [x] Save the research result in English for future development reference.
- [x] Create a reusable image list module boundary.
- [x] Extract image rendering away from the Home page.
- [x] Integrate `masonic` into the reusable image list module.
- [x] Integrate `react-selecto` at the reusable image list module layer.
- [x] Move Home to consume the reusable image list module.
- [x] Add infinite-loading capable list behavior for Home.
- [x] Verify build.
- [x] Verify lint.

## Next Recommended Steps
- [ ] Add a visible selection UX for pages that require multi-select operations.
- [ ] Add shift-range selection behavior.
- [ ] Add bulk action toolbar driven by `selectedIds`.
- [ ] Add a true fixed-size grid mode if a strict management grid becomes necessary.
- [ ] Reuse the image list module in Groups / Search / Upload flows.
- [ ] Add performance tuning after real dataset testing (`overscanBy`, `columnWidth`, paging size).
- [ ] Add route-level code splitting to reduce bundle size.
