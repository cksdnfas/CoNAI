import { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Redo2, Search, Undo2, WrapText } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'var(--text-sm)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.625' },
  '.cm-content': { padding: '0.5rem 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 0.75rem' },
  '.cm-gutters': { backgroundColor: 'var(--surface-low)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--primary) 6%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--primary) 24%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 28%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--primary) 32%, transparent)', outline: '1px solid var(--primary)' },
  '.cm-panels': { backgroundColor: 'var(--surface-low)', color: 'var(--foreground)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel': { fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)' },
  '.cm-panel.cm-search': { padding: '0.5rem 1.75rem 0.5rem 0.5rem' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
  '.cm-search input[type=checkbox]': { accentColor: 'var(--primary)' },
  '.cm-textfield': { maxWidth: '100%', backgroundColor: 'var(--field)', color: 'var(--foreground)', border: '1px solid var(--outline-input)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem' },
  '.cm-button': { backgroundColor: 'var(--surface-high)', backgroundImage: 'none', color: 'var(--foreground)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem', cursor: 'pointer' },
  '.cm-button:hover': { backgroundColor: 'var(--surface-highest)' },
  '.cm-textfield:focus-visible, .cm-button:focus-visible, .cm-search button[name=close]:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '1px' },
  '.cm-search button[name=close]': { color: 'var(--muted-foreground)', cursor: 'pointer' },
})

const koreanPhrases = EditorState.phrases.of({
  Find: '찾기', Replace: '바꿀 내용', next: '다음', previous: '이전', all: '모두 선택',
  'match case': '대소문자 구분', regexp: '정규식', 'by word': '단어 단위',
  replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기',
  'Go to line': '줄 이동', go: '이동', 'current match': '현재 일치 항목', 'on line': '줄',
  'replaced match on line $': '$번째 줄의 항목을 바꿨어', 'replaced $ matches': '$개 항목을 바꿨어',
})

function editorStatus(state: EditorState) {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  return { line: line.number, column: head - line.from + 1, lines: state.doc.lines, canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 }
}

/** Plain text only. Save shortcuts bubble to the enclosing editor's existing save handler. */
export function PlainTextEditor({ value, onChange, autoFocus = false }: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const { t, language, formatNumber } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const syncValue = useRef<((value: string) => void) | null>(null)
  const latest = useRef({ value, onChange, autoFocus, language, t })
  latest.current = { value, onChange, autoFocus, language, t }
  const [wrapping] = useState(() => new Compartment())
  const [localization] = useState(() => new Compartment())
  const [wrap, setWrap] = useState(true)
  const [status, setStatus] = useState({ line: 1, column: 1, lines: 1, canUndo: false, canRedo: false })
  const characters = useMemo(() => Array.from(value).length, [value])

  useEffect(() => {
    if (!host.current) return
    // An explicit separator preserves Windows CRLF files when reading and saving.
    const lineBreak = latest.current.value.match(/\r\n|\r|\n/)?.[0] ?? '\n'
    let applyingValue = false
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
          keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
          wrapping.of(EditorView.lineWrapping),
          localization.of([
            latest.current.language === 'ko' ? koreanPhrases : [],
            EditorView.contentAttributes.of({ 'aria-label': latest.current.t({ ko: '내용', en: 'Content' }), spellcheck: 'false' }),
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
  }, [wrapping, localization])

  useEffect(() => { syncValue.current?.(value) }, [value])
  useEffect(() => { view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) }) }, [wrap, wrapping])
  useEffect(() => {
    view.current?.dispatch({ effects: localization.reconfigure([
      language === 'ko' ? koreanPhrases : [],
      EditorView.contentAttributes.of({ 'aria-label': t({ ko: '내용', en: 'Content' }), spellcheck: 'false' }),
    ]) })
  }, [language, t, localization])

  const run = (command: (view: EditorView) => boolean) => {
    if (view.current) { view.current.focus(); command(view.current) }
  }

  return (
    <div className="theme-input-surface overflow-hidden rounded-sm border focus-within:border-primary/55">
      <div role="group" aria-label={t({ ko: '텍스트 편집 도구', en: 'Text editing tools' })} className="flex items-center gap-1 border-b px-2 py-1">
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '실행 취소', en: 'Undo' })} disabled={!status.canUndo} onClick={() => run(undo)}><Undo2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '다시 실행', en: 'Redo' })} disabled={!status.canRedo} onClick={() => run(redo)}><Redo2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '찾기·바꾸기', en: 'Find and replace' })} onClick={() => run(openSearchPanel)}><Search /></IconButton>
        <span className="flex-1" />
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '자동 줄바꿈', en: 'Word wrap' })} active={wrap} onClick={() => setWrap(!wrap)}><WrapText /></IconButton>
      </div>
      <div ref={host} className="h-[55vh] min-h-40" />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
        <span>{t({ ko: '{characters}자 · {lines}줄', en: '{characters} characters · {lines} lines' }, { characters: formatNumber(characters), lines: formatNumber(status.lines) })}</span>
        <span>{t({ ko: '{line}행, {column}열', en: 'Ln {line}, Col {column}' }, { line: formatNumber(status.line), column: formatNumber(status.column) })}</span>
      </div>
    </div>
  )
}
