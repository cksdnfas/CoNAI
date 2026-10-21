import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VirtuosoMasonry, type ItemContent } from '@virtuoso.dev/masonry'
import type { PostCategory, PostSummary } from '@conai/shared'
import { EyeOff, FileClock, Images, MessageCircle, MessageSquare, Pin } from 'lucide-react'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ToggleChip } from '@/components/ui/chip'
import { useImageListColumnCount } from '@/features/images/components/image-list/use-image-list-column-count'
import { useI18n } from '@/i18n'
import { getImage } from '@/lib/api-images'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import { libraryMediaKind, postCoverUrl as coverUrl } from './post-media'
import { PostAuthorAvatar, PostAuthorName, useRelativeTime } from './post-author'
import { usePostPermissions } from './use-post-permissions'
import { PostKnowledgeStatus } from './post-knowledge-status'
import { PostTopicSummary } from './post-topic-relevance'

type ListProps = {
  posts: PostSummary[]
  categories: PostCategory[]
  onOpen: (post: PostSummary) => void
  onTag: (tag: string) => void
  /** Right-click / long-press actions on one item (e.g. restore from the trash). */
  menu?: (post: PostSummary) => ActionMenuEntry[]
  /** A click opens `menu` instead of the post (trashed documents cannot be opened). */
  menuOnClick?: boolean
}

/** In search results: the comment a post was found through. */
function MatchedComment({ post }: { post: PostSummary }) {
  if (!post.matchedComment) return null
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <MessageSquare className="size-3.5 shrink-0" aria-hidden />
      <span className="shrink-0 font-medium text-foreground">{post.matchedComment.author}</span>
      <span className="truncate">{post.matchedComment.excerpt}</span>
    </p>
  )
}

/** Title with the pin before it and the post's state after it (draft, hidden, knowledge badge). */
function PostTitle({ post, className }: { post: PostSummary; className?: string }) {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {post.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label={t({ ko: '고정', en: 'Pinned' })} /> : null}
      <span className={cn('min-w-0 font-semibold', className)}>{post.title}</span>
      {post.status === 'draft' ? <FileClock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t({ ko: '초안', en: 'Draft' })} /> : null}
      {post.status === 'hidden' ? <EyeOff className="size-3.5 shrink-0 text-destructive" aria-label={t({ ko: '숨김', en: 'Hidden' })} /> : null}
      <PostKnowledgeStatus knowledge={post.knowledge} />
    </div>
  )
}

function PostMeta({ post, categories, className, showAuthor = true }: { post: PostSummary; categories: PostCategory[]; className?: string; showAuthor?: boolean }) {
  const relative = useRelativeTime()
  const category = categories.find((item) => item.id === post.categoryId)
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground', className)}>
      {showAuthor ? <><PostAuthorAvatar author={post.author} size="xs" /><PostAuthorName author={post.author} className="max-w-40" /></> : null}
      {category ? <>{showAuthor ? <span aria-hidden>·</span> : null}<span className="truncate">{category.name}</span></> : null}
      {showAuthor || category ? <span aria-hidden>·</span> : null}
      <span className="whitespace-nowrap">{relative(post.publishedAt ?? post.updatedAt)}</span>
      {post.commentCount > 0 ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden>·</span><span className="inline-flex items-center gap-0.5"><MessageCircle className="size-3" />{post.commentCount}</span></span> : null}
    </div>
  )
}

function TagRow({ tags, onTag }: { tags: string[]; onTag: (tag: string) => void }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <ToggleChip key={tag} size="sm" pressed={false} onClick={(event) => { event.stopPropagation(); onTag(tag) }}>#{tag}</ToggleChip>
      ))}
    </div>
  )
}

/** Rows: cover, title, meta, two lines of text and tags. */
export function PostFeed({ posts, categories, onOpen, onTag, menu, menuOnClick = false }: ListProps) {
  const { canViewImages } = usePostPermissions()
  return (
    <div className="flex flex-col">
      {posts.map((post) => {
        const cover = canViewImages ? coverUrl(post.media) : null
        return (
          <ActionContextMenu key={post.id} entries={menu?.(post) ?? []} openOnClick={menuOnClick}>
            <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }}
              className={cn('grid cursor-pointer gap-4 border-b border-line py-4 outline-none first:pt-1 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40', cover && 'sm:grid-cols-[9rem_1fr]')}>
              {cover ? <img src={cover} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-sm bg-surface-low object-cover sm:w-36" /> : null}
              <div className="flex min-w-0 flex-col gap-1.5">
                <PostTitle post={post} className="truncate text-base" />
                <PostMeta post={post} categories={categories} />
                {post.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p> : null}
                <MatchedComment post={post} />
                <TagRow tags={post.tags} onTag={onTag} />
                <PostTopicSummary value={post.topicEvaluation} />
              </div>
            </div>
          </ActionContextMenu>
        )
      })}
    </div>
  )
}

const CARD_MIN_WIDTH = 260
const CARD_GAP = 16
const CARD_MAX_COLUMNS = 3
type CardContext = Omit<ListProps, 'posts'> & { canViewImages: boolean }

const PostCard: ItemContent<PostSummary, CardContext> = ({ data: post, context }) => {
  if (!post) return null
  const { categories, onOpen, onTag, menu, menuOnClick, canViewImages } = context
  const cover = canViewImages ? coverUrl(post.media) : null
  return (
    <div className="pb-5">
      <ActionContextMenu entries={menu?.(post) ?? []} openOnClick={menuOnClick}>
        <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }}
          className="flex cursor-pointer flex-col gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {cover ? <img src={cover} alt="" loading="lazy" className="block h-auto w-full rounded-sm bg-surface-low" /> : (
            <p className="line-clamp-6 border-l-2 border-line pl-3 text-sm text-muted-foreground">{post.excerpt}</p>
          )}
          <PostTitle post={post} className="line-clamp-2" />
          <PostMeta post={post} categories={categories} />
          <MatchedComment post={post} />
          <TagRow tags={post.tags} onTag={onTag} />
          <PostTopicSummary value={post.topicEvaluation} />
        </div>
      </ActionContextMenu>
    </div>
  )
}

/** Masonry cards: the cover at its own height, then title and meta. Virtualized on the window scroll like the image feed. */
export function PostCards({ posts, categories, onOpen, onTag, menu, menuOnClick = false }: ListProps) {
  const { canViewImages } = usePostPermissions()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const fitColumns = useImageListColumnCount(container, CARD_MIN_WIDTH, CARD_GAP)
  const columnCount = Math.min(CARD_MAX_COLUMNS, fitColumns)
  // As in ImageListMasonry: VirtuosoMasonry seeds columns only at mount, so remount while posts are fewer than columns.
  const masonryKey = posts.length < columnCount ? `sparse:${posts.length}:${columnCount}` : 'dense'
  return (
    <div ref={setContainer}>
      <VirtuosoMasonry<PostSummary, CardContext>
        key={masonryKey}
        data={posts}
        context={{ categories, onOpen, onTag, menu, menuOnClick, canViewImages }}
        useWindowScroll
        columnCount={columnCount}
        initialItemCount={Math.min(posts.length, Math.max(columnCount * 2, 8))}
        style={{ columnGap: `${CARD_GAP}px` }}
        ItemContent={PostCard}
      />
    </div>
  )
}

/** One library item filling an SNS slide; moving media plays while the slide is on screen. */
function SnsMedia({ hash, active }: { hash: string; active: boolean }) {
  const query = useQuery({ queryKey: ['post-media', hash], queryFn: ({ signal }) => getImage(hash, { signal }), staleTime: 5 * 60_000, retry: false })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const kind = libraryMediaKind(query.data)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (active) void video.play().catch(() => undefined)
    else video.pause()
  }, [active, kind])
  if (kind === 'video') {
    return <video ref={videoRef} src={active ? buildApiUrl(`/api/images/${hash}/file`) : undefined} poster={buildApiUrl(`/api/images/${hash}/thumbnail`)} muted loop playsInline className="size-full object-contain" />
  }
  return <img src={buildApiUrl(`/api/images/${hash}/${kind === 'animated' && active ? 'file' : 'thumbnail'}`)} alt="" loading="lazy" draggable={false} className="size-full object-contain" />
}

function SnsSlide({ post, categories, onOpen, onTag, onVisible, loadMedia }: Omit<ListProps, 'posts'> & { post: PostSummary; onVisible: (postId: number) => void; loadMedia: boolean }) {
  const { t } = useI18n()
  const { canViewImages } = usePostPermissions()
  const ref = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const media = canViewImages ? post.media.filter((item) => item.kind === 'media') : []
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.intersectionRatio >= 0.6)
      setActive(visible)
      if (visible) onVisible(post.id)
    }, { threshold: [0, 0.6] })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onVisible, post.id])

  return (
    <article ref={ref} className="relative flex h-full snap-start snap-always flex-col items-center justify-center py-3">
      <div className="flex h-full w-full max-w-xl flex-col gap-2">
        <div className="flex items-center gap-2">
          <PostAuthorAvatar author={post.author} size="md" />
          <div className="flex min-w-0 flex-col">
            <PostAuthorName author={post.author} className="text-sm" />
            <PostMeta post={post} categories={categories} showAuthor={false} />
          </div>
        </div>
        {media.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm bg-black">
            <div
              className="flex size-full snap-x snap-mandatory scroll-x theme-nav-scroll"
              onScroll={(event) => {
                const target = event.currentTarget
                setIndex(Math.round(target.scrollLeft / Math.max(1, target.clientWidth)))
              }}
            >
              {media.map((item, mediaIndex) => (
                <div key={item.ref} role="button" tabIndex={0} className="size-full shrink-0 cursor-pointer snap-center" onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} aria-label={post.title}>
                  {loadMedia && Math.abs(mediaIndex - index) <= 1 ? <SnsMedia hash={item.ref} active={active && mediaIndex === index} /> : null}
                </div>
              ))}
            </div>
            {media.length > 1 ? (
              <>
                <Badge variant="overlay" size="sm" className="pointer-events-none absolute top-2 right-2"><Images />{index + 1}/{media.length}</Badge>
                <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
                  {media.map((item, dot) => <span key={item.ref} className={cn('size-1.5 rounded-full', dot === index ? 'bg-white' : 'bg-white/40')} />)}
                </span>
              </>
            ) : null}
          </div>
        ) : (
          <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} className="flex min-h-0 flex-1 cursor-pointer items-center rounded-sm bg-surface-low p-6 text-lg leading-relaxed">
            <span className="line-clamp-12">{post.excerpt || post.title}</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} className="cursor-pointer">
            <PostTitle post={post} className="truncate" />
          </div>
          {media.length > 0 && post.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p> : null}
          <div className="flex items-center gap-3">
            <TagRow tags={post.tags} onTag={onTag} />
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onOpen(post)} aria-label={t({ ko: '댓글', en: 'Comments' })}>
              <MessageCircle />{post.commentCount}
            </Button>
          </div>
          <PostTopicSummary value={post.topicEvaluation} />
        </div>
      </div>
    </article>
  )
}

/** One post per screen, media first, snapping as you scroll; the last slide asks for more. */
export function PostSns({ posts, categories, onOpen, onTag, onReachEnd }: ListProps & { onReachEnd: () => void }) {
  const [activePostId, setActivePostId] = useState<number | null>(null)
  const activeIndex = Math.max(0, posts.findIndex((post) => post.id === activePostId))
  const handleVisible = (postId: number) => {
    setActivePostId(postId)
    if (postId === posts[posts.length - 1]?.id) onReachEnd()
  }

  return (
    <div className="-mx-4 h-[calc(100dvh-8.5rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain px-4 sm:mx-0 sm:px-0">
      {posts.map((post, index) => (
        <SnsSlide key={post.id} post={post} categories={categories} onOpen={onOpen} onTag={onTag} onVisible={handleVisible} loadMedia={Math.abs(index - activeIndex) <= 1} />
      ))}
    </div>
  )
}
