import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { MessageSquare, Newspaper, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { usePostPermissions } from '@/features/posts/use-post-permissions'
import { parsePostLink, postRoute, type PostRef } from '@/features/posts/post-links'
import { useI18n } from '@/i18n'
import type { CodexChatToolCall } from '@/lib/api-codex-chat'
import { getPost, POSTS_QUERY_KEY } from '@/lib/api-posts'
import { buildApiUrl } from '@/lib/api-url'

const POST_LINK_IN_TEXT = /\]\(\s*post:(\d+)(?:#comment-(\d+))?\s*\)/g
const CARD_LIMIT = 3

function numberOf(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** The first match of `pattern` in a tool's output (its JSON result, maybe cut short), as a number. */
function fromOutput(call: CodexChatToolCall, pattern: RegExp) {
  const match = pattern.exec(call.output ?? call.summary ?? '')
  return match ? numberOf(match[1]) : null
}

/**
 * The posts a reply wrote or points at: posts it created or edited and comments it wrote (board tools), then
 * `post:` links in its text. One per post, the first mention deciding whether it is about a comment.
 */
export function postRefsOf(calls: CodexChatToolCall[], text: string): PostRef[] {
  const refs: PostRef[] = []
  const add = (postId: number | null, commentId: number | null = null) => {
    if (postId !== null && !refs.some((ref) => ref.postId === postId)) refs.push({ postId, commentId })
  }
  for (const call of calls) {
    if (call.status !== 'completed') continue
    const args = (call.arguments ?? {}) as Record<string, unknown>
    if (call.tool === 'posts_create') add(fromOutput(call, /"id":(\d+)/))
    else if (call.tool === 'posts_update') add(numberOf(args.post_id))
    else if (call.tool === 'post_comment') add(numberOf(args.post_id) ?? fromOutput(call, /"post_id":(\d+)/), fromOutput(call, /"id":(\d+)/))
  }
  for (const match of text.matchAll(POST_LINK_IN_TEXT)) add(numberOf(match[1]), match[2] ? numberOf(match[2]) : null)
  return refs.slice(0, CARD_LIMIT)
}

const REFERENCE_LINE = /^\[([^\]\n]+)\]\(\s*(post:\d+(?:#comment-\d+)?)\s*\)$/

/** The `[label](post:…)` lines a message starts with (posts referenced from the board), and the text after them. */
export function splitPostRefLines(content: string): { refs: Array<PostRef & { label: string }>; text: string } {
  const lines = content.split('\n')
  const refs: Array<PostRef & { label: string }> = []
  let index = 0
  for (; index < lines.length; index += 1) {
    const match = REFERENCE_LINE.exec(lines[index].trim())
    const ref = match ? parsePostLink(match[2]) : null
    if (!match || !ref) break
    refs.push({ ...ref, label: match[1] })
  }
  return refs.length ? { refs, text: lines.slice(index).join('\n').trim() } : { refs, text: content }
}

/** One referenced post or comment as a chip: a link to it, with a remove button while it is still a draft. */
export function ChatPostRefChip({ item, onRemove }: { item: PostRef & { label: string }; onRemove?: () => void }) {
  const { t } = useI18n()
  const Icon = item.commentId ? MessageSquare : Newspaper
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-line pl-2 pr-1 text-xs">
      <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
      <Link to={postRoute(item)} className="max-w-56 truncate hover:underline" title={item.label}>{item.label}</Link>
      {onRemove ? <IconButton variant="ghost" size="icon-xs" label={t({ ko: '참조 빼기', en: 'Remove reference' })} onClick={onRemove}><X /></IconButton> : <span className="w-1" />}
    </span>
  )
}

/** Cards for the posts a reply wrote or links, above its text; a post the reader cannot open shows no card. */
export function ChatPostCards({ calls, text }: { calls: CodexChatToolCall[]; text: string }) {
  const { t, formatNumber } = useI18n()
  const permissions = usePostPermissions()
  const refs = permissions.canView ? postRefsOf(calls, text) : []
  const queries = useQueries({
    queries: refs.map((ref) => ({ queryKey: [POSTS_QUERY_KEY, 'post', ref.postId], queryFn: () => getPost(ref.postId), retry: false, staleTime: 30_000 })),
  })
  const cards = refs.flatMap((ref, index) => {
    const post = queries[index]?.data
    return post ? [{ ref, post }] : []
  })
  if (!cards.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {cards.map(({ ref, post }) => {
        const cover = post.media.find((item) => item.kind === 'media' || item.kind === 'group')
        const coverUrl = cover && permissions.canViewImages ? buildApiUrl(cover.kind === 'media' ? `/api/images/${cover.ref}/thumbnail` : `/api/groups/${cover.ref}/thumbnail`) : null
        return (
          <Link
            key={ref.postId}
            to={postRoute(ref)}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-line p-2 pr-3 transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {coverUrl
              ? <img src={coverUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
              : <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-high text-muted-foreground"><Newspaper className="size-5" aria-hidden /></span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{post.title}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {ref.commentId ? <><MessageSquare className="size-3 shrink-0" aria-hidden />{t({ ko: '댓글', en: 'Comment' })}</> : t({ ko: '게시판', en: 'Board' })}
                {post.mediaCount > 0 ? <span>· {t({ ko: '미디어 {count}', en: '{count} media' }, { count: formatNumber(post.mediaCount) })}</span> : null}
                {post.commentCount > 0 ? <span>· {t({ ko: '댓글 {count}', en: '{count} comments' }, { count: formatNumber(post.commentCount) })}</span> : null}
              </span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
