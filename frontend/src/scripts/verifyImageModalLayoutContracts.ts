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

verifyModalToolbarStaysSingleLine()
verifyInfoToggleAvoidsImageNavigationControls()
verifyImageNavigationButtonsUseProjectChrome()
verifyModalKeyboardNavigationPreservesFormControls()
console.log('Image modal layout contracts verified.')
