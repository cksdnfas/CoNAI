import { memo, useMemo, type ComponentProps } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeMentions } from '@/features/codex-chat/chat-mentions'
import { cn } from '@/lib/utils'
import { AudioEmbed, FileEmbed, GroupEmbed, LibraryMedia, MediaGallery } from './post-media'

const EMBED = String.raw`!\[[^\]\n]*\]\(\s*(?:media|audio|group|file):[^)\s]+\s*\)`
const EMBED_LINE = new RegExp(String.raw`^\s*(?:${EMBED}\s*)+$`)
const MEDIA_EMBED = /!\[([^\]\n]*)\]\(\s*media:([a-f0-9]{48}|[a-f0-9]{32})(?:\.[a-z0-9]{1,5})?\s*\)/gi
const APP_SCHEME = /^(media|audio|group|file|gallery):/

/** Library ids in body order, for the lightbox. */
export function mediaHashesOf(body: string) {
  return [...new Set([...body.matchAll(MEDIA_EMBED)].map((match) => match[2].toLowerCase()))]
}

/**
 * Lines that hold nothing but library media, next to each other (blank lines between them allowed), become one
 * `![](gallery:hash,hash)` so they render as a masonry gallery. Code fences are left alone.
 */
function groupGalleries(body: string) {
  const lines = body.split('\n')
  const out: string[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const mediaOnly = !inFence && EMBED_LINE.test(line) && line.replace(MEDIA_EMBED, '').trim() === ''
    if (!mediaOnly) {
      out.push(line)
      continue
    }
    const hashes: string[] = []
    let end = index
    for (let cursor = index; cursor < lines.length; cursor++) {
      const candidate = lines[cursor]
      if (!candidate.trim()) continue
      if (!EMBED_LINE.test(candidate) || candidate.replace(MEDIA_EMBED, '').trim() !== '') break
      hashes.push(...[...candidate.matchAll(MEDIA_EMBED)].map((match) => match[2].toLowerCase()))
      end = cursor
    }
    out.push(hashes.length > 1 ? `![](gallery:${hashes.join(',')})` : line)
    index = end
  }
  return out.join('\n')
}

function urlTransform(url: string) {
  return APP_SCHEME.test(url) ? url : defaultUrlTransform(url)
}

function EmbedImage({ src, alt }: ComponentProps<'img'>) {
  const source = typeof src === 'string' ? src : ''
  const match = /^(media|audio|group|file|gallery):([^\s]+)$/.exec(source)
  if (!match) return <img src={source} alt={alt ?? ''} loading="lazy" className="my-2 max-h-96 max-w-full rounded-sm" />
  const [, kind, ref] = match
  if (kind === 'gallery') return <MediaGallery items={ref.split(',').map((hash) => ({ hash }))} />
  if (kind === 'media') return <LibraryMedia hash={ref.replace(/\.[a-z0-9]+$/i, '').toLowerCase()} caption={alt || undefined} className="my-3" />
  if (kind === 'audio') return <AudioEmbed candidateId={ref} caption={alt || undefined} />
  if (kind === 'group') return <GroupEmbed groupId={Number(ref)} caption={alt || undefined} />
  return <FileEmbed fileId={ref.toLowerCase()} caption={alt || undefined} />
}

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }
const holdsEmbed = (node: HastNode | undefined) => (node?.children ?? []).some((child) => child.type === 'element' && child.tagName === 'img' && APP_SCHEME.test(String(child.properties?.src ?? '')))

const COMPONENTS: Components = {
  img: EmbedImage,
  // A paragraph with an embed becomes a div: embeds are blocks (players, galleries), which may not sit inside <p>.
  p: ({ node, children }) => holdsEmbed(node as HastNode | undefined) ? <div className="my-3">{children}</div> : <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{children}</a>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h2 className="mb-2 mt-6 text-xl font-bold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-2 mt-6 text-lg font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-5 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1.5 mt-4 font-semibold first:mt-0">{children}</h5>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-line pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-5 border-line" />,
  table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-[0.92em]">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-line px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line/60 px-2 py-1 align-top">{children}</td>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-sm bg-surface-low p-3 font-mono text-[0.85em] leading-relaxed">{children}</pre>,
  code: ({ children, className }: ComponentProps<'code'>) => <code className={cn(className ? '' : 'rounded-sm bg-surface-high px-1 py-0.5', 'font-mono text-[0.9em]', className)}>{children}</code>,
}

/**
 * A post or comment body: GitHub-flavoured Markdown without raw HTML, plus app media written as
 * `![caption](media|audio|group|file:ref)`. `mentions` highlights `@name` (comments).
 */
export const PostMarkdown = memo(function PostMarkdown({ text, mentions, className }: { text: string; mentions?: readonly string[]; className?: string }) {
  const rehypePlugins = useMemo(() => (mentions?.length ? [rehypeMentions(mentions)] : []), [mentions])
  const source = useMemo(() => groupGalleries(text), [text])
  return (
    <div className={cn('break-words leading-relaxed text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={COMPONENTS} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
    </div>
  )
})
