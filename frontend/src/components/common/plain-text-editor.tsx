import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightTrailingWhitespace, highlightWhitespace, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { AArrowDown, AArrowUp, ArrowDownAZ, ArrowUpZA, CaseLower, CaseUpper, CornerDownRight, Eraser, ListFilter, ListX, Pilcrow, Redo2, Search, Undo2, Wrench, WrapText } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { withShortcut } from '@/lib/keyboard-shortcut'
import { cn } from '@/lib/utils'

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.625' },
  '.cm-content': { padding: '0.5rem 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 0.75rem' },
  '.cm-gutters': { backgroundColor: 'var(--surface-low)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 0.25rem', cursor: 'pointer' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-high)', color: 'var(--muted-foreground)', border: 'none', padding: '0 0.375rem' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--primary) 6%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--primary) 24%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--primary) 22%, transparent)', outline: 'none' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--destructive) 24%, transparent)' },
  '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--muted-foreground) 55%, transparent) 15%, transparent 16%)' },
  '.cm-highlightTab': { backgroundImage: 'none', position: 'relative' },
  '.cm-highlightTab::before': { content: '"→"', position: 'absolute', left: '0', color: 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)' },
  '.cm-trailingSpace': { backgroundColor: 'color-mix(in srgb, var(--destructive) 18%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 28%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--primary) 32%, transparent)', outline: '1px solid var(--primary)' },
  '.cm-panels': { backgroundColor: 'var(--surface-low)', color: 'var(--foreground)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel': { fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)' },
  '.cm-panel.cm-search, .cm-panel.cm-gotoLine': { padding: '0.5rem 1.75rem 0.5rem 0.5rem' },
  '.cm-search label, .cm-gotoLine label': { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
  '.cm-search input[type=checkbox]': { accentColor: 'var(--primary)' },
  '.cm-textfield': { maxWidth: '100%', backgroundColor: 'var(--field)', color: 'var(--foreground)', border: '1px solid var(--outline-input)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem' },
  '.cm-button': { backgroundColor: 'var(--surface-high)', backgroundImage: 'none', color: 'var(--foreground)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem', cursor: 'pointer' },
  '.cm-button:hover': { backgroundColor: 'var(--surface-highest)' },
  '.cm-textfield:focus-visible, .cm-button:focus-visible, .cm-search button[name=close]:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '1px' },
  '.cm-search button[name=close]': { color: 'var(--muted-foreground)', cursor: 'pointer' },
})

/** Syntax colours from the app's tokens, so code reads in both themes and every appearance preset. */
const syntaxStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: 'var(--primary)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--warning)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--muted-foreground)' },
  { tag: tags.comment, fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: 'var(--info)' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.definition(tags.variableName)], color: 'var(--info)', fontWeight: '600' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '700' },
  { tag: tags.heading1, fontSize: '1.15em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--info)', textDecoration: 'underline' },
  { tag: tags.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [tags.monospace], color: 'var(--primary)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
])

const koreanPhrases = EditorState.phrases.of({
  Find: '찾기', Replace: '바꿀 내용', next: '다음', previous: '이전', all: '모두 선택',
  'match case': '대소문자 구분', regexp: '정규식', 'by word': '단어 단위',
  replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기',
  'Go to line': '줄 이동', go: '이동', 'current match': '현재 일치 항목', 'on line': '줄',
  'replaced match on line $': '$번째 줄의 항목을 바꿨어', 'replaced $ matches': '$개 항목을 바꿨어',
  'Fold line': '접기', 'Unfold line': '펼치기', 'folded code': '접힌 내용', unfold: '펼치기',
})

const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20]
const DEFAULT_FONT_SIZE = 14
const PREFS_KEY = 'conai.plain-text-editor'
type EditorPrefs = { wrap: boolean; fontSize: number; whitespace: boolean }
const DEFAULT_PREFS: EditorPrefs = { wrap: true, fontSize: DEFAULT_FONT_SIZE, whitespace: false }

function readPrefs(): EditorPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<EditorPrefs> | null
    return {
      wrap: typeof stored?.wrap === 'boolean' ? stored.wrap : DEFAULT_PREFS.wrap,
      fontSize: FONT_SIZES.includes(Number(stored?.fontSize)) ? Number(stored?.fontSize) : DEFAULT_PREFS.fontSize,
      whitespace: typeof stored?.whitespace === 'boolean' ? stored.whitespace : DEFAULT_PREFS.whitespace,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

const fontSizeTheme = (size: number) => EditorView.theme({ '&': { fontSize: `${size}px` } })
const whitespaceExtension = (on: boolean): Extension => on ? [highlightWhitespace(), highlightTrailingWhitespace()] : []

type LineTool = 'sortAsc' | 'sortDesc' | 'dedupe' | 'trimTrailing' | 'dropEmpty' | 'upper' | 'lower'

/** Rewrites the selected lines (or the whole text with no selection) in one undoable step. */
function applyLineTool(view: EditorView, tool: LineTool, collator: Intl.Collator) {
  const { state } = view
  const selection = state.selection.main
  let from = 0, to = state.doc.length
  if (!selection.empty) {
    if (tool === 'upper' || tool === 'lower') ({ from, to } = selection)
    else {
      from = state.doc.lineAt(selection.from).from
      // A selection that ends at the start of a line does not include that line.
      const end = selection.to > selection.from && state.doc.lineAt(selection.to).from === selection.to ? selection.to - 1 : selection.to
      to = state.doc.lineAt(end).to
    }
  }
  const text = state.sliceDoc(from, to)
  const rewriteLines = (rewrite: (lines: string[]) => string[]) => rewrite(text.split(state.lineBreak)).join(state.lineBreak)
  const next = tool === 'upper' ? text.toUpperCase()
    : tool === 'lower' ? text.toLowerCase()
      : tool === 'sortAsc' ? rewriteLines((lines) => [...lines].sort(collator.compare))
        : tool === 'sortDesc' ? rewriteLines((lines) => [...lines].sort((a, b) => collator.compare(b, a)))
          : tool === 'dedupe' ? rewriteLines((lines) => [...new Set(lines)])
            : tool === 'trimTrailing' ? rewriteLines((lines) => lines.map((line) => line.replace(/[ \t]+$/, '')))
              : rewriteLines((lines) => lines.filter((line) => line.trim() !== ''))
  if (next === text) return false
  const length = state.toText(next).length
  view.dispatch({
    changes: { from, to, insert: next },
    selection: selection.empty ? undefined : EditorSelection.range(from, from + length),
    userEvent: 'input',
    scrollIntoView: true,
  })
  return true
}

function editorStatus(state: EditorState) {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const selected = state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0)
  return { line: line.number, column: head - line.from + 1, lines: state.doc.lines, selected, canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 }
}

export type PlainTextEditorHandle = {
  /** Put these lines at the caret, each on its own line, and move the caret after them. */
  insertLines: (lines: string[]) => boolean
}

/**
 * Plain text with a code editor's tools: syntax colours picked from `fileName`, folding, find/replace, go to line,
 * line clean-up tools, font size, visible whitespace and wrapping (the last three remembered per browser).
 * Save shortcuts bubble to the enclosing editor's existing save handler. `bare` drops the frame for a caller that
 * already draws one; `heightClassName` sizes the text area (fixed height scrolls inside, none grows with the text).
 */
export function PlainTextEditor({ value, onChange, autoFocus = false, fileName, ariaLabel, bare = false, heightClassName = 'h-[55vh] min-h-40', ref }: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  fileName?: string
  /** Accessible name of the text area (default "내용"). */
  ariaLabel?: string
  bare?: boolean
  heightClassName?: string
  ref?: Ref<PlainTextEditorHandle>
}) {
  const { t, language, formatNumber } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const syncValue = useRef<((value: string) => void) | null>(null)
  const label = ariaLabel ?? t({ ko: '내용', en: 'Content' })
  const latest = useRef({ value, onChange, autoFocus, language, label })
  latest.current = { value, onChange, autoFocus, language, label }
  const [compartments] = useState(() => ({
    wrapping: new Compartment(), localization: new Compartment(), syntax: new Compartment(), fontSize: new Compartment(), whitespace: new Compartment(),
  }))
  const [prefs, setPrefs] = useState(readPrefs)
  const [languageName, setLanguageName] = useState<string | null>(null)
  // An explicit separator preserves Windows CRLF files when reading and saving.
  const [lineBreak] = useState(() => value.match(/\r\n|\r|\n/)?.[0] ?? '\n')
  const [status, setStatus] = useState({ line: 1, column: 1, lines: 1, selected: 0, canUndo: false, canRedo: false })
  const characters = useMemo(() => Array.from(value).length, [value])
  const collator = useMemo(() => new Intl.Collator(language, { numeric: true, sensitivity: 'base' }), [language])
  const initialPrefs = useRef(prefs)

  useEffect(() => {
    if (!host.current) return
    let applyingValue = false
    const { wrapping, localization, syntax, fontSize, whitespace } = compartments
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          EditorState.lineSeparator.of(lineBreak),
          EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n|\r|\n/g, state.lineBreak)),
          EditorState.allowMultipleSelections.of(true),
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), rectangularSelection(),
          history(), search({ top: true }), highlightSelectionMatches(),
          syntaxHighlighting(syntaxStyle), syntax.of([]),
          keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          wrapping.of(initialPrefs.current.wrap ? EditorView.lineWrapping : []),
          fontSize.of(fontSizeTheme(initialPrefs.current.fontSize)),
          whitespace.of(whitespaceExtension(initialPrefs.current.whitespace)),
          localization.of([
            latest.current.language === 'ko' ? koreanPhrases : [],
            EditorView.contentAttributes.of({ 'aria-label': latest.current.label, spellcheck: 'false' }),
          ]),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingValue) latest.current.onChange(update.state.sliceDoc())
            if (update.docChanged || update.selectionSet) setStatus(editorStatus(update.state))
          }),
        ],
      }),
    })
    view.current = instance
    setStatus(editorStatus(instance.state))
    if (latest.current.autoFocus) instance.focus()
    // Prop changes (including chat edits) stay undoable without echoing them back to the parent.
    syncValue.current = (nextValue) => {
      const next = instance.state.toText(nextValue)
      const previous = instance.state.doc
      if (previous.eq(next)) return
      const before = previous.toString(), after = next.toString()
      let from = 0, endBefore = before.length, endAfter = after.length
      while (from < endBefore && from < endAfter && before[from] === after[from]) from++
      while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }
      applyingValue = true
      try {
        instance.dispatch({ changes: { from, to: endBefore, insert: next.slice(from, endAfter) }, annotations: isolateHistory.of('full') })
      } finally {
        applyingValue = false
      }
    }
    return () => {
      syncValue.current = null
      view.current = null
      instance.destroy()
    }
  }, [compartments, lineBreak])

  // Language support loads on demand (each grammar is its own chunk); plain .txt stays without it.
  useEffect(() => {
    let cancelled = false
    const apply = (extension: Extension, name: string | null) => {
      if (cancelled) return
      setLanguageName(name)
      view.current?.dispatch({ effects: compartments.syntax.reconfigure(extension) })
    }
    if (!fileName || /\.(txt|log)$/i.test(fileName)) { apply([], null); return () => { cancelled = true } }
    void import('@codemirror/language-data').then(({ languages }) => {
      const description = LanguageDescription.matchFilename(languages, fileName)
      if (!description) { apply([], null); return }
      return description.load().then((support) => apply([support, bracketMatching(), foldGutter(), indentOnInput()], description.name))
    }).catch(() => apply([], null))
    return () => { cancelled = true }
  }, [fileName, compartments])

  useEffect(() => { syncValue.current?.(value) }, [value])
  useEffect(() => {
    view.current?.dispatch({ effects: [
      compartments.wrapping.reconfigure(prefs.wrap ? EditorView.lineWrapping : []),
      compartments.fontSize.reconfigure(fontSizeTheme(prefs.fontSize)),
      compartments.whitespace.reconfigure(whitespaceExtension(prefs.whitespace)),
    ] })
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private window or blocked storage */ }
  }, [prefs, compartments])
  useEffect(() => {
    view.current?.dispatch({ effects: compartments.localization.reconfigure([
      language === 'ko' ? koreanPhrases : [],
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
    ]) })
  }, [language, label, compartments])

  useImperativeHandle(ref, () => ({
    insertLines: (lines) => {
      const instance = view.current
      if (!instance || !lines.length) return false
      const { state } = instance
      const { from, to } = state.selection.main
      const br = state.lineBreak
      const before = state.sliceDoc(0, from)
      const after = state.sliceDoc(to)
      const block = `${before && !before.endsWith(br) ? br : ''}${lines.join(br)}${br}${after.startsWith(br) || !after ? '' : br}`
      instance.dispatch({ changes: { from, to, insert: block }, selection: EditorSelection.cursor(from + state.toText(block).length), userEvent: 'input', scrollIntoView: true })
      instance.focus()
      return true
    },
  }), [])

  const run = (command: (view: EditorView) => boolean) => {
    if (view.current) { view.current.focus(); command(view.current) }
  }
  const fontIndex = FONT_SIZES.indexOf(prefs.fontSize)
  const setFontSize = (step: number) => setPrefs((current) => ({ ...current, fontSize: FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, FONT_SIZES.indexOf(current.fontSize) + step))] }))
  const lineTool = (tool: LineTool, label: string, icon: ReactNode) => (
    <DropdownMenuItem key={tool} onSelect={() => run((instance) => applyLineTool(instance, tool, collator))}>{icon}{label}</DropdownMenuItem>
  )
  const hasSelection = status.selected > 0

  return (
    <div className={cn('flex min-w-0 flex-col', !bare && 'theme-input-surface overflow-hidden rounded-sm border focus-within:border-primary/55')}>
      <div role="toolbar" aria-label={t({ ko: '텍스트 편집 도구', en: 'Text editing tools' })} className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1 [scrollbar-width:none]">
        <IconButton variant="ghost" size="icon-sm" label={withShortcut(t({ ko: '실행 취소', en: 'Undo' }), 'Mod+Z')} disabled={!status.canUndo} onClick={() => run(undo)}><Undo2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" label={withShortcut(t({ ko: '다시 실행', en: 'Redo' }), 'Mod+Y')} disabled={!status.canRedo} onClick={() => run(redo)}><Redo2 /></IconButton>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
        <IconButton variant="ghost" size="icon-sm" label={withShortcut(t({ ko: '찾기·바꾸기', en: 'Find and replace' }), 'Mod+F')} onClick={() => run(openSearchPanel)}><Search /></IconButton>
        <IconButton variant="ghost" size="icon-sm" label={withShortcut(t({ ko: '줄 이동', en: 'Go to line' }), 'Mod+Alt+G')} onClick={() => run(gotoLine)}><CornerDownRight /></IconButton>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" label={hasSelection ? t({ ko: '선택한 줄 정리', en: 'Tidy selected lines' }) : t({ ko: '줄 정리', en: 'Tidy lines' })}><Wrench /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { event.preventDefault(); view.current?.focus() }}>
            {lineTool('sortAsc', t({ ko: '오름차순 정렬', en: 'Sort ascending' }), <ArrowDownAZ />)}
            {lineTool('sortDesc', t({ ko: '내림차순 정렬', en: 'Sort descending' }), <ArrowUpZA />)}
            {lineTool('dedupe', t({ ko: '중복 줄 지우기', en: 'Remove duplicate lines' }), <ListFilter />)}
            {lineTool('dropEmpty', t({ ko: '빈 줄 지우기', en: 'Remove empty lines' }), <ListX />)}
            {lineTool('trimTrailing', t({ ko: '줄 끝 공백 지우기', en: 'Trim trailing spaces' }), <Eraser />)}
            <DropdownMenuSeparator />
            {lineTool('upper', t({ ko: '대문자로', en: 'Uppercase' }), <CaseUpper />)}
            {lineTool('lower', t({ ko: '소문자로', en: 'Lowercase' }), <CaseLower />)}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="min-w-2 flex-1" />
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '글자 작게', en: 'Smaller text' })} disabled={fontIndex <= 0} onClick={() => setFontSize(-1)}><AArrowDown /></IconButton>
        <span className="w-7 shrink-0 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">{prefs.fontSize}</span>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '글자 크게', en: 'Larger text' })} disabled={fontIndex >= FONT_SIZES.length - 1} onClick={() => setFontSize(1)}><AArrowUp /></IconButton>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '공백 문자 표시', en: 'Show whitespace' })} active={prefs.whitespace} onClick={() => setPrefs((current) => ({ ...current, whitespace: !current.whitespace }))}><Pilcrow /></IconButton>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '자동 줄바꿈', en: 'Word wrap' })} active={prefs.wrap} onClick={() => setPrefs((current) => ({ ...current, wrap: !current.wrap }))}><WrapText /></IconButton>
      </div>
      <div ref={host} className={cn('min-h-0', heightClassName)} />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
        <span>
          {t({ ko: '{characters}자 · {lines}줄', en: '{characters} characters · {lines} lines' }, { characters: formatNumber(characters), lines: formatNumber(status.lines) })}
          {hasSelection ? t({ ko: ' · {selected}자 선택', en: ' · {selected} selected' }, { selected: formatNumber(status.selected) }) : null}
        </span>
        <span className="flex gap-3">
          {languageName ? <span>{languageName}</span> : null}
          <span>{lineBreak === '\r\n' ? 'CRLF' : lineBreak === '\r' ? 'CR' : 'LF'}</span>
          <span>{t({ ko: '{line}행, {column}열', en: 'Ln {line}, Col {column}' }, { line: formatNumber(status.line), column: formatNumber(status.column) })}</span>
        </span>
      </div>
    </div>
  )
}
