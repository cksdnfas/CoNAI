# Image List Migration Checklist — Virtuoso + ViSelect

Date: 2026-03-21

## Migration Checklist
- [x] Confirm migration direction: Virtuoso + ViSelect
- [x] Confirm reusable image list requirement beyond Home
- [x] Install `react-virtuoso`
- [x] Install `@virtuoso.dev/masonry`
- [x] Install `@viselect/vanilla`
- [x] Remove `masonic`
- [x] Remove `react-selecto`
- [x] Create the new reusable image-list engine files
- [x] Add grid mode using `VirtuosoGrid`
- [x] Add masonry mode using `VirtuosoMasonry`
- [x] Add DOM-driven drag selection using ViSelect
- [x] Add generic load-more trigger for both layouts
- [x] Migrate Home to the new engine
- [x] Remove obsolete Masonic-specific runtime code
- [x] Remove obsolete research/checklist files tied to Masonic
- [x] Verify frontend build
- [x] Verify frontend lint
- [ ] Commit the full migration state
