import { useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Eye } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const PREVIEWABLE_LANGUAGES = new Set(['html', 'htm', 'svg', 'xml'])

/** A whole reply that is an HTML document (no fence) is shown as an html code block instead of vanishing. */
function fenceBareHtml(text: string) {
  const trimmed = text.trim()
  return /^(<!doctype html|<html[\s>]|<svg[\s>])/i.test(trimmed) && !trimmed.includes('```') ? `\`\`\`html\n${trimmed}\n\`\`\`` : text
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

/** HTML / SVG from a reply, rendered in a sandboxed frame: scripts run, but with no access to the app or its cookies. */
function HtmlPreviewModal({ open, source, onClose }: { open: boolean; source: string; onClose: () => void }) {
  const { t } = useI18n()
  const document = /<svg[\s>]/i.test(source.trim().slice(0, 200)) && !/<html[\s>]/i.test(source) ? `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${source}</body>` : source
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: 'HTML 미리보기', en: 'HTML preview' })} widthClassName="max-w-5xl">
      <ModalBody>
        <iframe title={t({ ko: 'HTML 미리보기', en: 'HTML preview' })} sandbox="allow-scripts" srcDoc={document} className="h-[70vh] w-full rounded-sm border border-line bg-white" />
      </ModalBody>
    </Modal>
  )
}

function CodeBlock({ language, code }: { language: string | null; code: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const canPreview = language !== null && PREVIEWABLE_LANGUAGES.has(language)

  return (
    <div className="my-2 overflow-hidden rounded-md border border-line bg-surface-low">
      <div className="flex h-8 items-center gap-1 border-b border-line pl-3 pr-1 text-xs text-muted-foreground">
        <span className="flex-1 truncate font-mono">{language ?? t({ ko: '코드', en: 'code' })}</span>
        {canPreview ? (
          <IconButton size="icon-xs" variant="ghost" onClick={() => setPreviewOpen(true)} label={t({ ko: '미리보기', en: 'Preview' })}>
            <Eye />
          </IconButton>
        ) : null}
        <IconButton
          size="icon-xs"
          variant="ghost"
          label={copied ? t({ ko: '복사했어', en: 'Copied' }) : t({ ko: '복사', en: 'Copy' })}
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }, () => undefined)
          }}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[0.85em] leading-relaxed"><code>{code}</code></pre>
      {canPreview ? <HtmlPreviewModal open={previewOpen} source={code} onClose={() => setPreviewOpen(false)} /> : null}
    </div>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{children}</a>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-[1.15em] font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-2 mt-4 text-[1.08em] font-bold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1.5 mt-3 font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mb-1.5 mt-3 font-semibold first:mt-0">{children}</h6>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-line pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-line" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[0.92em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line/60 px-2 py-1 align-top">{children}</td>,
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children
    const className = (child && typeof child === 'object' && 'props' in child ? (child as { props: { className?: string } }).props.className : undefined) ?? ''
    const language = /language-([\w+-]+)/.exec(className)?.[1]?.toLowerCase() ?? null
    return <CodeBlock language={language} code={textOf(child).replace(/\n$/, '')} />
  },
  code: ({ children, className }: ComponentProps<'code'>) => (
    // Fenced blocks are rendered by `pre`; this is inline code.
    <code className={cn('rounded-sm bg-surface-high px-1 py-0.5 font-mono text-[0.85em]', className)}>{children}</code>
  ),
}

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }

const DIALOGUE_CLASS = 'text-(--chat-rp-dialogue)'
const THOUGHT_CLASS = 'italic text-(--chat-rp-thought)'
const OPEN_QUOTES = new Set(['"', '“'])
const CLOSE_QUOTES = new Set(['"', '”'])
/** 'Thought' / ‘thought’, not an apostrophe inside a word (don't, it's). */
const THOUGHT_PATTERN = /((?<![\p{L}\p{N}])'[^'\n]+?'(?![\p{L}\p{N}])|‘[^’\n]+?’)/u
const SKIPPED_TAGS = new Set(['code', 'pre'])
const BLOCK_TAGS = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function span(className: string, value: string): HastNode {
  return { type: 'element', tagName: 'span', properties: { className: [className] }, children: [{ type: 'text', value }] }
}

function splitThoughts(value: string): HastNode[] {
  // split() with one capture group: odd entries are the thoughts.
  return value.split(THOUGHT_PATTERN).flatMap((part, index): HastNode[] => {
    if (!part) return []
    return [index % 2 === 1 ? span(THOUGHT_CLASS, part) : { type: 'text', value: part }]
  })
}

/**
 * Marks "dialogue" and 'thoughts' in a block's text; *narration* is already emphasis. The open-quote state runs across
 * the block's inline nodes, so a line like "Hi *waves* there" stays one piece of dialogue.
 */
function markRoleplayInline(children: HastNode[], state: { inDialogue: boolean }): HastNode[] {
  return children.flatMap((child): HastNode[] => {
    if (child.type === 'element') {
      if (SKIPPED_TAGS.has(child.tagName ?? '')) return [child]
      return [{ ...child, children: markRoleplayInline(child.children ?? [], state) }]
    }
    if (child.type !== 'text' || !child.value) return [child]
    const out: HastNode[] = []
    let buffer = ''
    const flush = () => {
      if (!buffer) return
      out.push(...(state.inDialogue ? [span(DIALOGUE_CLASS, buffer)] : splitThoughts(buffer)))
      buffer = ''
    }
    for (const char of child.value) {
      if (!state.inDialogue && OPEN_QUOTES.has(char)) {
        flush()
        state.inDialogue = true
        buffer = char
      } else if (state.inDialogue && CLOSE_QUOTES.has(char)) {
        buffer += char
        flush()
        state.inDialogue = false
      } else {
        buffer += char
      }
    }
    flush()
    return out
  })
}

function rehypeRoleplay() {
  const walk = (node: HastNode) => {
    if (node.type === 'element' && SKIPPED_TAGS.has(node.tagName ?? '')) return
    if (node.type === 'element' && BLOCK_TAGS.has(node.tagName ?? '')) {
      node.children = markRoleplayInline(node.children ?? [], { inDialogue: false })
      return
    }
    node.children?.forEach(walk)
  }
  return (tree: HastNode) => walk(tree)
}

/**
 * A reply as Markdown (GitHub flavour: tables, task lists, strikethrough). Raw HTML is not rendered; fence it to preview.
 * `roleplay` colours "dialogue", *narration* and 'thoughts' with the profile's colours (CSS variables on the transcript).
 */
export function ChatMarkdown({ text, roleplay = false }: { text: string; roleplay?: boolean }) {
  return (
    <div className={cn('chat-markdown break-words text-foreground', roleplay && '[&_em]:text-(--chat-rp-narration)')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={roleplay ? [rehypeRoleplay] : []} components={MARKDOWN_COMPONENTS}>
        {fenceBareHtml(text)}
      </ReactMarkdown>
    </div>
  )
}
