/// <reference types="node" />

import { doesNotMatch, match, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function sliceRequiredSource(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf(end, startIndex)

  ok(startIndex >= 0, `missing source marker: ${start}`)
  ok(endIndex > startIndex, `missing source marker: ${end}`)

  return sourceText.slice(startIndex, endIndex)
}

function verifyModalToolbarStaysSingleLine() {
  const imageDetailSource = source('src/features/images/image-detail-view.tsx')
  const modalActionsSource = source('src/features/images/components/detail/image-view-modal-actions.tsx')
  const cssSource = source('src/index.css')

  match(
    imageDetailSource,
    /className="image-detail-modal-header-actions min-w-0 flex-1"/,
    'modal header actions should be a min-width:0 flex child so available toolbar width is used before overflow',
  )
  match(
    imageDetailSource,
    /className="shrink-0 flex-nowrap whitespace-nowrap border-white\/14 bg-black\/42 text-white/,
    'modal image-area tabs should stay on one line instead of wrapping labels',
  )
  match(
    modalActionsSource,
    /className="image-detail-modal-toolbar-actions flex w-full min-w-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto"/,
    'modal action row should not wrap; narrow widths should use horizontal overflow instead',
  )
  doesNotMatch(
    modalActionsSource,
    /flex w-full flex-wrap items-center justify-between/,
    'modal action row must not reintroduce flex-wrap',
  )
  match(
    cssSource,
    /\.image-detail-modal-toolbar-inner \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?align-items: center;/,
    'modal toolbar should keep header actions and tabs on the same row',
  )

  const singleColumnToolbarCss = sliceRequiredSource(
    cssSource,
    '@media (max-width: 919px) {',
    '    .image-detail-modal-info-pane,',
  )

  doesNotMatch(
    singleColumnToolbarCss,
    /flex-direction:\s*column/,
    '1-column modal toolbar must not force a line break while horizontal space remains',
  )
  match(
    singleColumnToolbarCss,
    /overflow-x:\s*auto;/,
    '1-column modal toolbar should scroll horizontally rather than wrap',
  )
}

function verifyInfoToggleAvoidsImageNavigationControls() {
  const cssSource = source('src/index.css')
  const infoToggleCss = sliceRequiredSource(
    cssSource,
    '  .image-detail-modal-info-toggle-desktop,\n  .image-detail-modal-info-reopen-desktop {',
    '  .image-detail-modal-info-toggle-desktop {',
  )

  match(
    infoToggleCss,
    /top: calc\(5\.5rem \+ env\(safe-area-inset-top, 0px\)\);/,
    'desktop info collapse/reopen controls should sit near the top, below the toolbar',
  )
  doesNotMatch(
    infoToggleCss,
    /top:\s*50%/,
    'desktop info controls must not share the vertical centerline with image previous/next buttons',
  )
  doesNotMatch(
    infoToggleCss,
    /translateY\(-50%\)/,
    'desktop info controls must not be vertically centered over image navigation buttons',
  )
}

function verifyImageNavigationButtonsUseProjectChrome() {
  const imageDetailSource = source('src/features/images/image-detail-view.tsx')
  const navigationSource = sliceRequiredSource(
    imageDetailSource,
    'function ImageDetailModalNavigationButtons',
    'interface ImageDetailViewProps',
  )

  match(
    navigationSource,
    /buttonClassName = 'group\/modal-nav /,
    'image previous/next buttons should expose a named hover group for shared project chrome',
  )
  match(
    navigationSource,
    /buttonInnerClassName = '[^']*rounded-sm[^']*border-white\/14[^']*bg-black\/42[^']*shadow-\[0_12px_32px_rgba\(0,0,0,0\.38\)\]/,
    'image previous/next buttons should use the same squared overlay chrome as modal toolbar buttons',
  )
  doesNotMatch(
    navigationSource,
    /buttonInnerClassName = '[^']*rounded-full/,
    'image previous/next buttons must not use pill/circle chrome in this modal',
  )
}

function verifyModalOverlayLoadsOffClickPath() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const openImageViewSource = sliceRequiredSource(
    providerSource,
    'const openImageView = useCallback((input: ImageViewModalOpenInput) => {',
    '  const syncImageViewSequence = useCallback',
  )
  const preloadIndex = openImageViewSource.indexOf('void loadImageViewModalOverlay()')
  const stateUpdateIndex = openImageViewSource.indexOf('setModalState((current) => {')

  match(
    providerSource,
    /let imageViewModalOverlayLoadPromise: Promise<\{ default: ImageViewModalOverlayComponent \}> \| null = null/,
    'modal overlay import should be cached so idle preload and React.lazy share the same chunk promise',
  )
  match(
    providerSource,
    /function loadImageViewModalOverlay\(\) \{[\s\S]*?import\('\.\/image-view-modal-overlay'\)[\s\S]*?imageViewModalOverlayLoadPromise = null[\s\S]*?return imageViewModalOverlayLoadPromise[\s\S]*?\}/,
    'modal overlay import should be centralized and reset on load failure for retryable opens',
  )
  match(
    providerSource,
    /const ImageViewModalOverlayLazy = lazy\(loadImageViewModalOverlay\)/,
    'React.lazy should consume the same modal overlay loader used by preload paths',
  )
  match(
    providerSource,
    /requestIdleCallback[\s\S]*?loadImageViewModalOverlay\(\)[\s\S]*?setTimeout[\s\S]*?loadImageViewModalOverlay\(\)/,
    'image modal overlay chunk should be warmed during idle time with a timer fallback',
  )
  match(
    providerSource,
    /useEffect\(\(\) => scheduleImageViewModalOverlayPreload\(\), \[\]\)/,
    'image modal provider should schedule the off-click overlay preload after mount',
  )
  ok(
    preloadIndex >= 0 && preloadIndex < stateUpdateIndex,
    'opening the image modal should start loading the overlay chunk before rendering lazy modal state',
  )
}

function verifyModalKeyboardNavigationPreservesFormControls() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const keyboardSource = sliceRequiredSource(
    providerSource,
    'const handleKeyDown = (event: KeyboardEvent) => {',
    "    document.body.style.overflow = 'hidden'",
  )
  const editingGuardIndex = keyboardSource.indexOf('isModalKeyboardEditingTarget(event.target)')
  const arrowNavigationIndex = keyboardSource.indexOf("event.key === 'ArrowLeft' || event.key === 'ArrowRight'")

  match(
    providerSource,
    /function isModalKeyboardEditingTarget\(target: EventTarget \| null\)/,
    'modal keyboard shortcuts should centralize form-control target detection',
  )
  match(
    providerSource,
    /tagName === 'INPUT' \|\| tagName === 'TEXTAREA' \|\| tagName === 'SELECT' \|\| target\.isContentEditable/,
    'modal keyboard shortcuts should preserve arrows for inputs, textareas, selects, and content-editable controls',
  )
  match(
    keyboardSource,
    /if \(event\.defaultPrevented\) \{[\s\S]*?return[\s\S]*?\}/,
    'modal keyboard shortcuts should not override nested handlers that already handled a key event',
  )
  ok(
    editingGuardIndex > arrowNavigationIndex,
    'modal keyboard shortcut handler should check focused form controls inside the arrow-navigation branch',
  )
  match(
    keyboardSource,
    /if \(isModalKeyboardEditingTarget\(event\.target\)\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*event\.preventDefault\(\)/,
    'modal arrow navigation should not prevent default while a form control is focused',
  )
}

function verifyModalSourceItemsIndexAvoidsIntermediateArrays() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const sourceItemsIndexSource = sliceRequiredSource(
    providerSource,
    'function buildSourceItemsByHash(items?: ImageRecord[]) {',
    'function isModalKeyboardEditingTarget',
  )

  match(
    sourceItemsIndexSource,
    /const sourceItemsByHash: Record<string, ImageRecord> = \{\}/,
    'modal source-item lookup should build directly into a hash-index record',
  )
  match(
    sourceItemsIndexSource,
    /for \(const item of items \?\? \[\]\) \{[\s\S]*?sourceItemsByHash\[compositeHash\] = item/,
    'modal source-item lookup should fill the hash index in one pass over the source items',
  )
  doesNotMatch(
    sourceItemsIndexSource,
    /\.map\(|\.filter\(|Object\.fromEntries/,
    'modal source-item lookup must not allocate map/filter/fromEntries intermediates for large media lists',
  )
}

function verifyModalSequenceSyncSkipsRedundantItemMerge() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const syncHelpersSource = sliceRequiredSource(
    providerSource,
    'function areCompositeHashesEqual(currentHashes: string[], nextHashes: string[]) {',
    'function isModalKeyboardEditingTarget',
  )
  const syncImageViewSequenceSource = sliceRequiredSource(
    providerSource,
    'const syncImageViewSequence = useCallback',
    '  const closeImageView = useCallback',
  )

  match(
    syncHelpersSource,
    /for \(let index = 0; index < nextHashes\.length; index \+= 1\)/,
    'modal sequence equality should use a direct loop instead of allocating callback closures',
  )
  match(
    syncHelpersSource,
    /function mergeSourceItemsByHash[\s\S]*?for \(const compositeHash in nextItemsByHash\)[\s\S]*?return \{ \.\.\.currentItemsByHash, \.\.\.nextItemsByHash \}[\s\S]*?return currentItemsByHash/,
    'modal source-item sync should only spread the lookup record when incoming source items changed',
  )
  match(
    syncImageViewSequenceSource,
    /mergeSourceItemsByHash\(current\.sourceItemsByHash, nextSourceItemsByHash\)/,
    'modal sequence sync should use the guarded source-item merge helper',
  )
  match(
    syncImageViewSequenceSource,
    /const isSameItems = mergedSourceItemsByHash === current\.sourceItemsByHash/,
    'modal sequence sync should detect unchanged source items by retained lookup identity',
  )
  doesNotMatch(
    syncImageViewSequenceSource,
    /Object\.keys\(mergedSourceItemsByHash\)|Object\.entries\(mergedSourceItemsByHash\)|nextCompositeHashes\.every/,
    'modal sequence sync must not rescan merged source items or allocate array callbacks to detect no-op updates',
  )
}

function verifyInfoViewerStatePersistsAcrossModalNavigation() {
  const imageDetailSource = source('src/features/images/image-detail-view.tsx')
  const breakpointSyncSource = sliceRequiredSource(
    imageDetailSource,
    "  useEffect(() => {\n    if (presentation === 'modal') {\n      setIsModalInfoViewerOpen(canUseDesktopModalLayout)",
    '  useEffect(() => {\n    return () => {',
  )

  match(
    breakpointSyncSource,
    /\}, \[canUseDesktopModalLayout, presentation\]\)/,
    'modal info viewer should only sync to the desktop/mobile breakpoint, not to each image change',
  )
  doesNotMatch(
    breakpointSyncSource,
    /compositeHash/,
    'modal info viewer open/collapsed state should persist while navigating previous/next images',
  )
}

function verifyDesktopInfoTogglesAreDesktopOnly() {
  const imageDetailSource = source('src/features/images/image-detail-view.tsx')
  const modalSource = sliceRequiredSource(
    imageDetailSource,
    "  if (presentation === 'modal') {",
    "  const detailViewportHeightClassName =",
  )

  match(
    modalSource,
    /!isModalInfoViewerOpen && canUseDesktopModalLayout \? \(/,
    'desktop info reopen control should not render in the 1-column bottom-sheet layout',
  )
  match(
    modalSource,
    /\{canUseDesktopModalLayout \? \(\s*<Button[\s\S]*?className="image-detail-modal-info-toggle-desktop"/,
    'desktop info collapse control should not render in the 1-column bottom-sheet layout',
  )
}

function verifySingleColumnInfoViewerReservesImageHeight() {
  const cssSource = source('src/index.css')
  const singleColumnCss = sliceRequiredSource(
    cssSource,
    '@media (max-width: 919px) {',
    '  .scrollbar-stable-pane {',
  )
  const singleColumnLayoutCss = sliceRequiredSource(
    singleColumnCss,
    '    .image-detail-modal-layout,\n    .image-detail-modal-layout.info-collapsed {',
    '    .image-detail-modal-toolbar {',
  )

  match(
    singleColumnCss,
    /--image-detail-modal-info-open-height:\s*100%;/,
    '1-column expanded info viewer should cover the full modal height',
  )
  match(
    singleColumnCss,
    /--image-detail-modal-info-height:\s*var\(--image-detail-modal-info-open-height\);/,
    '1-column modal should use the expanded info viewer height as a layout variable',
  )
  match(
    singleColumnCss,
    /\.image-detail-modal-layout\.info-collapsed \{[\s\S]*?--image-detail-modal-info-height:\s*var\(--image-detail-modal-info-collapsed-height\);/,
    '1-column collapsed info viewer should reserve only its header height',
  )
  match(
    singleColumnCss,
    /grid-template-rows:\s*minmax\(0, 1fr\) var\(--image-detail-modal-info-height\);/,
    '1-column modal image pane should fill the remaining height above the info viewer',
  )
  match(
    singleColumnCss,
    /\.image-detail-modal-info-pane,[\s\S]*?\.image-detail-modal-layout\.info-collapsed \.image-detail-modal-info-pane \{[\s\S]*?position:\s*relative;[\s\S]*?height:\s*100%;[\s\S]*?transform:\s*none;/,
    '1-column info viewer should occupy the reserved bottom row instead of overlaying the image pane',
  )
  match(
    singleColumnCss,
    /\.image-detail-modal-layout\.info-collapsed \.image-detail-modal-info-content \{[\s\S]*?display:\s*none;/,
    '1-column collapsed info viewer should hide metadata content inside the reserved header row',
  )
  doesNotMatch(
    singleColumnLayoutCss,
    /display:\s*block;/,
    '1-column modal layout must not fall back to block flow because it collapses the image pane height',
  )
}

function verifyImageNavigationButtonsRemainAvailableInSingleColumn() {
  const imageDetailSource = source('src/features/images/image-detail-view.tsx')
  const navigationSource = sliceRequiredSource(
    imageDetailSource,
    'function ImageDetailModalNavigationButtons',
    'interface ImageDetailViewProps',
  )

  match(
    navigationSource,
    /buttonClassName = '[^']*\bflex\b[^']*\bopacity-100\b[^']*\bmd:opacity-0\b/,
    'image previous/next buttons should remain visible in narrow 1-column modal widths',
  )
  doesNotMatch(
    navigationSource,
    /\bhidden\b[^']*\bmd:flex\b/,
    'image previous/next buttons must not disappear below the md breakpoint',
  )
}

verifyModalToolbarStaysSingleLine()
verifyInfoToggleAvoidsImageNavigationControls()
verifyImageNavigationButtonsUseProjectChrome()
verifyModalOverlayLoadsOffClickPath()
verifyModalKeyboardNavigationPreservesFormControls()
verifyModalSourceItemsIndexAvoidsIntermediateArrays()
verifyModalSequenceSyncSkipsRedundantItemMerge()
verifyInfoViewerStatePersistsAcrossModalNavigation()
verifyDesktopInfoTogglesAreDesktopOnly()
verifySingleColumnInfoViewerReservesImageHeight()
verifyImageNavigationButtonsRemainAvailableInSingleColumn()
console.log('Image modal layout contracts verified.')
