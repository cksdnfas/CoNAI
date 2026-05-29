/// <reference types="node" />

import { doesNotMatch, match, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function sliceRequiredSource(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start)
  const endIndex = sourceText.indexOf(end, startIndex)

  ok(startIndex >= 0, `missing source marker: ${start}`)
  ok(endIndex > startIndex, `missing source marker: ${end}`)

  return sourceText.slice(startIndex, endIndex)
}

function verifyModalToolbarKeepsActionsVisible() {
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
    /className="image-detail-modal-image-tabs shrink-0 flex-nowrap whitespace-nowrap border-white\/14 bg-black\/42 text-white/,
    'modal image-area tabs should stay on one line inside their own scrollable control',
  )
  match(
    imageDetailSource,
    /\{ value: 'current', label: t\(\{ ko: '이미지', en: 'Image' \}\) \}/,
    'modal image tab label should stay short enough for the 1-column toolbar',
  )
  match(
    imageDetailSource,
    /\{ value: 'similar', label: t\(\{ ko: '유사', en: 'Similar' \}\), disabled:/,
    'modal similar tab label should stay short enough for the 1-column toolbar',
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
    'wide modal toolbar should keep header actions and tabs on the same row',
  )

  const singleColumnToolbarCss = sliceRequiredSource(
    cssSource,
    '@media (max-width: 919px) {',
    '    .image-detail-modal-info-pane,',
  )

  match(
    singleColumnToolbarCss,
    /\.image-detail-modal-toolbar-inner \{[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;/,
    '1-column modal toolbar should split actions and tabs into separate rows so action buttons stay visible',
  )
  match(
    singleColumnToolbarCss,
    /\.image-detail-modal-header-actions \{[\s\S]*?width:\s*100%;[\s\S]*?\}/,
    '1-column modal action row should receive the full toolbar width',
  )
  match(
    singleColumnToolbarCss,
    /\.image-detail-modal-image-tabs \{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/,
    '1-column modal tabs should scroll inside their own row rather than covering action buttons',
  )
}

function verifyInfoToggleAvoidsImageNavigationControls() {
  const cssSource = source('src/index.css')
  const infoToggleCss = sliceRequiredSource(
    cssSource,
    '.image-detail-modal-info-toggle-desktop,',
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

function verifyModalNeighborPreviewWarmupUsesSourceItems() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const neighborPrefetchSource = sliceRequiredSource(
    providerSource,
    '    const neighborHashes = [modalState.compositeHashes[activeIndex - 1], modalState.compositeHashes[activeIndex + 1]]',
    '  }, [activeIndex, modalState.compositeHash, modalState.compositeHashes, modalState.sourceItemsByHash, queryClient])',
  )

  match(
    neighborPrefetchSource,
    /for \(const neighborHash of neighborHashes\) \{[\s\S]*?warmImagePreviewSource\(modalState\.sourceItemsByHash\[neighborHash\]\)[\s\S]*?queryClient\.prefetchQuery/,
    'modal previous/next navigation should warm neighboring preview image URLs from the current source-item index before detail fetches resolve',
  )
  match(
    providerSource,
    /\[activeIndex, modalState\.compositeHash, modalState\.compositeHashes, modalState\.sourceItemsByHash, queryClient\]/,
    'neighbor preview warmup should rerun when synced source items add preview URLs for the active modal sequence',
  )
}

function verifyModalPreviewWarmupDedupesUrls() {
  const providerSource = source('src/features/images/components/detail/image-view-modal-provider.tsx')
  const warmupSource = sliceRequiredSource(
    providerSource,
    'const MAX_WARMED_IMAGE_PREVIEW_SOURCE_URLS = 48',
    'function buildSourceItemsByHash',
  )

  match(
    warmupSource,
    /const warmedImagePreviewSourceUrls: string\[\] = \[\][\s\S]*?const warmedImagePreviewSourceUrlSet = new Set<string>\(\)/,
    'modal preview warmup should keep a small URL cache beside the best-effort image preloader',
  )
  match(
    warmupSource,
    /function rememberWarmedImagePreviewSourceUrl\(previewUrl: string\)[\s\S]*?warmedImagePreviewSourceUrlSet\.has\(previewUrl\)[\s\S]*?warmedImagePreviewSourceUrls\.push\(previewUrl\)[\s\S]*?warmedImagePreviewSourceUrls\.length > MAX_WARMED_IMAGE_PREVIEW_SOURCE_URLS[\s\S]*?warmedImagePreviewSourceUrlSet\.delete\(expiredPreviewUrl\)/,
    'modal preview warmup should skip URLs already warmed while bounding the dedupe cache',
  )
  match(
    warmupSource,
    /if \(!rememberWarmedImagePreviewSourceUrl\(previewUrl\)\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*const previewImage = new Image\(\)/,
    'modal preview warmup should check the URL cache before allocating another Image preloader',
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

function verifyImageModalMediaStartsFromContainedCenter() {
  const mediaSource = source('src/features/images/components/detail/image-detail-media.tsx')

  match(
    mediaSource,
    /const \[naturalMediaSize, setNaturalMediaSize\] = useState<MediaSize \| null>\(null\)/,
    'modal image should track natural media dimensions before calculating the fitted frame',
  )
  match(
    mediaSource,
    /new ResizeObserver\(\(\[entry\]\) => \{[\s\S]*?setViewportSize\(getElementSize\(entry\.target\)\)/,
    'modal image should observe the real viewport size instead of relying on intrinsic CSS max-height behavior',
  )
  match(
    mediaSource,
    /const fitScale = Math\.min\(viewportSize\.width \/ naturalMediaSize\.width, viewportSize\.height \/ naturalMediaSize\.height\)/,
    'modal image fit should use contain math against both viewport axes',
  )
  match(
    mediaSource,
    /const resetView = useCallback\(\(\) => \{[\s\S]*?scaleRef\.current = DEFAULT_SCALE[\s\S]*?setScale\(DEFAULT_SCALE\)[\s\S]*?setOffset\(\{ x: 0, y: 0 \}\)[\s\S]*?\}, \[\]\)/,
    'modal reset should return to the fitted contain scale and centered offset',
  )
  match(
    mediaSource,
    /useEffect\(\(\) => \{[\s\S]*?setNaturalMediaSize\(null\)[\s\S]*?scaleRef\.current = DEFAULT_SCALE[\s\S]*?setScale\(DEFAULT_SCALE\)[\s\S]*?\}, \[renderUrl\]\)/,
    'changing modal images should not inherit a stale zoom level from a previous image',
  )
  doesNotMatch(
    mediaSource,
    /IMAGE_DETAIL_SCALE_STORAGE_KEY|loadImageDetailScale|persistImageDetailScale/,
    'modal image zoom scale must not be persisted across images because default view should always be fitted contain',
  )
}

verifyModalToolbarKeepsActionsVisible()
verifyInfoToggleAvoidsImageNavigationControls()
verifyImageNavigationButtonsUseProjectChrome()
verifyModalOverlayLoadsOffClickPath()
verifyModalKeyboardNavigationPreservesFormControls()
verifyModalSourceItemsIndexAvoidsIntermediateArrays()
verifyModalSequenceSyncSkipsRedundantItemMerge()
verifyModalNeighborPreviewWarmupUsesSourceItems()
verifyModalPreviewWarmupDedupesUrls()
verifyInfoViewerStatePersistsAcrossModalNavigation()
verifyDesktopInfoTogglesAreDesktopOnly()
verifySingleColumnInfoViewerReservesImageHeight()
verifyImageNavigationButtonsRemainAvailableInSingleColumn()
verifyImageModalMediaStartsFromContainedCenter()
console.log('Image modal layout contracts verified.')
