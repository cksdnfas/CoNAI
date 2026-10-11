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
      <div ref={innerRef} className="whitespace-pre-wrap break-words px-1.5 py-1.5 text-sm text-foreground">
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
