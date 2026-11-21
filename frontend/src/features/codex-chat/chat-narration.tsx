import { useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type RefObject } from 'react'
import { hasNarration, isNarrationLine, splitNarration } from '@conai/shared'
import { CodexChatUserMessage } from './codex-chat-message'

/** The profile's roleplay narration colour where the chat sets one, else the theme's accent text. */
export const NARRATION_COLOR = 'var(--chat-rp-narration, var(--secondary-text))'

/** The profile's narration colour for places outside the transcript (which sets it itself). */
export function narrationColorStyle(color: string | null | undefined) {
  return (color ? { '--chat-rp-narration': color } : {}) as CSSProperties
}

/** A `$` line in the draft: the composer then paints its lines (see ChatComposerNarrationBackdrop). */
export function draftHasNarration(text: string) {
  return text.includes('$') && text.split('\n').some(isNarrationLine)
}

export function caretOnNarration(text: string, caret: number) {
  return isNarrationLine(text.slice(0, caret).split('\n').pop() ?? '')
}

const NARRATION_MARK = '$ '

/** How much of a narration line is its mark: `$ `, or `$` alone where the rest would open with a mark again. */
function markLength(line: string) {
  return line[1] === ' ' && line[2] !== '$' ? 2 : 1
}

/**
 * The composer's narration key on the draft, with the selection after it. On a blank line the caret's line becomes
 * `$ `; on a line with text a narration line opens at the caret (the line's own start marks the line itself); a
 * selection marks each line with text; a narration line (or a selection of them alone) loses its mark instead.
 */
export function toggleNarrationMark(text: string, selectionStart: number, selectionEnd = selectionStart): { text: string; start: number; end: number } {
  const from = Math.max(0, Math.min(selectionStart, selectionEnd, text.length))
  const to = Math.max(from, Math.min(Math.max(selectionStart, selectionEnd), text.length))
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  // A selection that ends where a line starts leaves that line out.
  const last = to > from && text[to - 1] === '\n' ? to - 1 : to
  const lineEnd = text.indexOf('\n', last) < 0 ? text.length : text.indexOf('\n', last)
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const before = text.slice(0, lineStart)
  const after = text.slice(lineEnd)
  // An escaped `$$` line keeps its literal `$` as the narration's first character.
  const marked = (line: string) => NARRATION_MARK + (line.startsWith('$$') ? line.slice(1) : line)
  if (to === from || lines.every((line) => !line.trim())) {
    const line = text.slice(lineStart, text.indexOf('\n', from) < 0 ? text.length : text.indexOf('\n', from))
    const rest = text.slice(lineStart + line.length)
    if (isNarrationLine(line)) {
      const caret = Math.max(lineStart, from - markLength(line))
      return { text: before + line.slice(markLength(line)) + rest, start: caret, end: caret }
    }
    if (!line.trim() || from === lineStart) {
      const caret = lineStart + NARRATION_MARK.length
      return { text: before + (line.trim() ? marked(line) : NARRATION_MARK) + rest, start: caret, end: caret }
    }
    const caret = from + 1 + NARRATION_MARK.length
    return { text: `${text.slice(0, from)}\n${NARRATION_MARK}${text.slice(from)}`, start: caret, end: caret }
  }
  const unmark = lines.filter((line) => line.trim()).every(isNarrationLine)
  // Every change sits at a line's start: a position inside a removed mark moves to that start, later ones shift.
  const edits: Array<{ at: number; removed: number; added: number }> = []
  let at = lineStart
  const next = lines.map((line) => {
    const changed = !line.trim() ? line : unmark ? line.slice(markLength(line)) : isNarrationLine(line) ? line : marked(line)
    if (changed !== line) edits.push(unmark ? { at, removed: markLength(line), added: 0 } : { at, removed: line.startsWith('$$') ? 1 : 0, added: NARRATION_MARK.length })
    at += line.length + 1
    return changed
  })
  const map = (position: number) => edits.reduce((moved, edit) => position <= edit.at ? moved : moved + (position < edit.at + edit.removed ? edit.at - position : edit.added - edit.removed), position)
  return { text: before + next.join('\n') + after, start: map(from), end: map(to) }
}

/**
 * The composer's text drawn behind its textarea, which then shows only the caret and selection: narration lines in the
 * narration colour on a faint band, their `$` dimmed. It follows the textarea's width and scroll so the lines match.
 */
export function ChatComposerNarrationBackdrop({ textareaRef, text }: { textareaRef: RefObject<HTMLTextAreaElement | null>; text: string }) {
  const innerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const area = textareaRef.current
    const inner = innerRef.current
    if (!area || !inner) return
    // The band reaches 6px past the text on each side; the padding puts the text back where the textarea has it.
    const sync = () => {
      inner.style.width = `${area.clientWidth + 12}px`
      inner.style.transform = `translateY(${-area.scrollTop}px)`
    }
    sync()
    area.addEventListener('scroll', sync)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(area)
    return () => {
      area.removeEventListener('scroll', sync)
      observer?.disconnect()
    }
  }, [textareaRef, text])
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-1.5 inset-y-0 overflow-hidden">
      <div ref={innerRef} className="whitespace-pre-wrap break-words px-1.5 py-1 text-sm text-foreground">
        {text.split('\n').map((line, index) => isNarrationLine(line)
          ? <div key={index} className="-mx-1.5 rounded-sm px-1.5" style={{ color: NARRATION_COLOR, background: `color-mix(in srgb, ${NARRATION_COLOR} 12%, transparent)` }}><span className="opacity-45">$</span>{line.slice(1)}</div>
          : <div key={index}>{line || '​'}</div>)}
      </div>
    </div>
  )
}

export function ChatNarrationLine({ text }: { text: string }) {
  return <p className="mx-auto max-w-[85%] whitespace-pre-wrap break-words text-center italic" style={{ color: NARRATION_COLOR }}>{text}</p>
}

/** A user message; one holding narration lines shows in its order, narration on centred lines, the user's text as usual. */
export function ChatUserMessage({ content, ...props }: ComponentProps<typeof CodexChatUserMessage>) {
  if (!hasNarration(content)) return <CodexChatUserMessage {...props} content={content} />
  const parts = splitNarration(content)
  // The first stretch of the user's own text carries the name, picture, time and quote; later ones only their text.
  const head = parts.findIndex((part) => !part.narration)
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, index) => part.narration
        ? <ChatNarrationLine key={index} text={part.text} />
        : index === head
          ? <CodexChatUserMessage key={index} {...props} content={part.text} />
          : <CodexChatUserMessage key={index} content={part.text} mentions={props.mentions} appearance={props.appearance} bare />)}
    </div>
  )
}
