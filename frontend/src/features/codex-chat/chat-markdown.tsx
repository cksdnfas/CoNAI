import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { createContext, memo, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeMentions } from './chat-mentions'
import { Check, Copy, Eye } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { chatAssetUrl, chatEmoticonUrl, chatMediaUrl, type ChatDisplayBlock } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { buildApiUrl } from '@/lib/api-url'
import { BlockChangeChips, ChatDisplayBlocksContext, parseBlockPayload, useChatDisplayBlock } from './chat-display-block'
import { isolatedChatPreview } from './chat-preview'
import { injectChatEmoticons, type ChatEmoticonMap } from '@conai/shared'
/** The profile's emoticons for this reply: keyword (lower case) → image, and whose emoticon route serves them. */
export type { ChatEmoticonMap } from '@conai/shared'

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

/** Static generated HTML/SVG, with scripts, navigation grants and network loading disabled. */
function HtmlPreviewModal({ open, source, onClose }: { open: boolean; source: string; onClose: () => void }) {
  const { t } = useI18n()
  const document = /<svg[\s>]/i.test(source.trim().slice(0, 200)) && !/<html[\s>]/i.test(source) ? `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${source}</body>` : source
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: 'HTML 미리보기', en: 'HTML preview' })} widthClassName="max-w-5xl">
      <ModalBody>
        <iframe title={t({ ko: 'HTML 미리보기', en: 'HTML preview' })} sandbox="" srcDoc={isolatedChatPreview(document)} className="h-[70vh] w-full rounded-sm border border-line bg-white" />
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

/** A fenced block: the chips of a display block update when its name matches and the values parse, else plain code. */
function FencedBlock({ language, code }: { language: string | null; code: string }) {
  const block = useChatDisplayBlock(language)
  const data = block ? parseBlockPayload(code) : null
  return block && data ? <BlockChangeChips blockKey={block.key} data={data} /> : <CodeBlock language={language} code={code} />
}

const ChatEmoticonsContext = createContext<ChatEmoticonMap | null>(null)

const EMOTE_SCHEME = 'emote:'
const STICKER_SCHEME = 'emote-sticker:'
/** Images copied in from character cards before card media went to the library: `chat-asset:<sha256>.<ext>`. */
const ASSET_PATTERN = /^chat-asset:([a-f0-9]{64}\.(?:png|jpg|webp|gif))$/
/** Library media: `media:<composite hash>.<ext>`; the extension says image or video. */
const MEDIA_PATTERN = /^media:([a-f0-9]{48}|[a-f0-9]{32})\.([a-z0-9]{2,5})$/
const VIDEO_SOURCE = /\/api\/codex-chat\/media\/[a-f0-9]+\.(?:mp4|webm|mov)$/

/** Lets the emoticon schemes through; everything else gets react-markdown's safe default. */
function urlTransform(url: string) {
  const asset = ASSET_PATTERN.exec(url)
  if (asset) return chatAssetUrl(asset[1])
  const media = MEDIA_PATTERN.exec(url)
  if (media) return chatMediaUrl(media[1], media[2])
  return url.startsWith(EMOTE_SCHEME) || url.startsWith(STICKER_SCHEME) ? url : defaultUrlTransform(url)
}

function MarkdownImage({ src, alt }: ComponentProps<'img'>) {
  const { canViewImages } = useImagePermissions()
  const emoticons = useContext(ChatEmoticonsContext)
  const source = typeof src === 'string' ? src : ''
  const appMedia = source.startsWith(EMOTE_SCHEME) || source.startsWith(STICKER_SCHEME) || ['/api/images/', '/api/generation-history/', '/api/files/', '/api/codex-chat/media/', '/api/codex-chat/assets/', '/api/codex-chat/profiles/', '/uploads/', '/temp/', '/save/'].some((prefix) => source.startsWith(buildApiUrl(prefix)))
  if (!canViewImages && appMedia) return <span>{alt ?? ''}</span>
  const sticker = source.startsWith(STICKER_SCHEME)
  if (emoticons && (sticker || source.startsWith(EMOTE_SCHEME))) {
    const hash = source.slice(sticker ? STICKER_SCHEME.length : EMOTE_SCHEME.length)
    return (
      <img
        src={chatEmoticonUrl(emoticons.profileId, hash)}
        alt={alt ?? ''}
        title={alt ?? undefined}
        draggable={false}
        // Sizes come from the reader's chat appearance (CSS variables on the transcript); a tall inline emoticon
        // simply makes its line taller instead of overlapping the line above.
        className={sticker ? 'my-1 block h-auto max-h-(--chat-sticker-size,128px) w-auto max-w-full object-contain' : 'inline-block h-(--chat-emoticon-size,1.6em) w-auto align-text-bottom'}
      />
    )
  }
  if (VIDEO_SOURCE.test(source)) {
    return <video src={source} title={alt || undefined} aria-label={alt || undefined} autoPlay loop muted playsInline controls className="my-2 max-h-80 max-w-full rounded-sm" />
  }
  return <img src={source} alt={alt ?? ''} loading="lazy" className="my-2 max-h-80 max-w-full rounded-sm" />
}

const MARKDOWN_COMPONENTS: Components = {
  img: MarkdownImage,
  // Paragraph spacing follows the reader's chat appearance (a variable on the transcript); 0.5rem elsewhere.
  p: ({ children }) => <p className="my-(--chat-paragraph-gap,0.5rem) first:mt-0 last:mb-0">{children}</p>,
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
    return <FencedBlock language={language} code={textOf(child).replace(/\n$/, '')} />
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
export const ChatMarkdown = memo(function ChatMarkdown({ text, roleplay = false, blocks, emoticons = null, hiddenGroupIds, mentions }: {
  text: string
  roleplay?: boolean
  blocks?: ChatDisplayBlock[]
  emoticons?: ChatEmoticonMap | null
  hiddenGroupIds?: ReadonlySet<number>
  /** Group rooms: member names whose `@name` mentions are highlighted. */
  mentions?: readonly string[]
}) {
  const blocksByKey = useMemo(() => new Map((blocks ?? []).filter((block) => block.enabled && block.key).map((block) => [block.key, block])), [blocks])
  const rehypePlugins = useMemo(() => [...(roleplay ? [rehypeRoleplay] : []), ...(mentions?.length ? [rehypeMentions(mentions)] : [])], [roleplay, mentions])
  return (
    <ChatEmoticonsContext.Provider value={emoticons}>
      <ChatDisplayBlocksContext.Provider value={blocksByKey}>
        <div className={cn('chat-markdown break-words text-foreground', roleplay && '[&_em]:text-(--chat-rp-narration)')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={MARKDOWN_COMPONENTS} urlTransform={urlTransform}>
            {injectChatEmoticons(fenceBareHtml(text), emoticons, hiddenGroupIds)}
          </ReactMarkdown>
        </div>
      </ChatDisplayBlocksContext.Provider>
    </ChatEmoticonsContext.Provider>
  )
})
