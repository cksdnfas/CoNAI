import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PostCategory, PostMediaRef, PostSummary } from '@conai/shared'
import { EyeOff, FileClock, Images, MessageCircle, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import { getImage } from '@/lib/api-images'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import { libraryMediaKind } from './post-media'
import { PostAuthorAvatar, PostAuthorName, useRelativeTime } from './post-author'
import { usePostPermissions } from './use-post-permissions'

type ListProps = {
  posts: PostSummary[]
  categories: PostCategory[]
  onOpen: (post: PostSummary) => void
  onTag: (tag: string) => void
}

/** The first library item or group a post embeds, as a still cover. */
function coverUrl(media: PostMediaRef[]) {
  const first = media.find((item) => item.kind === 'media' || item.kind === 'group')
  if (!first) return null
  return buildApiUrl(first.kind === 'media' ? `/api/images/${first.ref}/thumbnail` : `/api/groups/${first.ref}/thumbnail`)
}

function StatusMarks({ post }: { post: PostSummary }) {
  const { t } = useI18n()
  return (
    <>
      {post.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label={t({ ko: '고정', en: 'Pinned' })} /> : null}
      {post.status === 'draft' ? <FileClock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t({ ko: '초안', en: 'Draft' })} /> : null}
      {post.status === 'hidden' ? <EyeOff className="size-3.5 shrink-0 text-destructive" aria-label={t({ ko: '숨김', en: 'Hidden' })} /> : null}
    </>
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
export function PostFeed({ posts, categories, onOpen, onTag }: ListProps) {
  const { canViewImages } = usePostPermissions()
  return (
    <div className="flex flex-col">
      {posts.map((post) => {
        const cover = canViewImages ? coverUrl(post.media) : null
        return (
          <div key={post.id} role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }}
            className={cn('grid cursor-pointer gap-4 border-b border-line py-4 outline-none first:pt-1 focus-visible:bg-fill', cover && 'sm:grid-cols-[9rem_1fr]')}>
            {cover ? <img src={cover} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-sm bg-surface-low object-cover sm:w-36" /> : null}
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <StatusMarks post={post} />
                <span className="truncate text-base font-semibold">{post.title}</span>
              </div>
              <PostMeta post={post} categories={categories} />
              {post.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p> : null}
              <TagRow tags={post.tags} onTag={onTag} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Masonry cards: the cover at its own height, then title and meta. */
export function PostCards({ posts, categories, onOpen, onTag }: ListProps) {
  const { canViewImages } = usePostPermissions()
  return (
    <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
      {posts.map((post) => {
        const cover = canViewImages ? coverUrl(post.media) : null
        return (
          <div key={post.id} role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }}
            className="mb-5 flex cursor-pointer break-inside-avoid flex-col gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {cover ? <img src={cover} alt="" loading="lazy" className="block h-auto w-full rounded-sm bg-surface-low" /> : (
              <p className="line-clamp-6 border-l-2 border-line pl-3 text-sm text-muted-foreground">{post.excerpt}</p>
            )}
            <div className="flex min-w-0 items-center gap-1.5">
              <StatusMarks post={post} />
              <span className="line-clamp-2 font-semibold">{post.title}</span>
            </div>
            <PostMeta post={post} categories={categories} />
            <TagRow tags={post.tags} onTag={onTag} />
          </div>
        )
      })}
    </div>
  )
}

/** One library item filling an SNS slide; moving media plays while the slide is on screen. */
function SnsMedia({ hash, active }: { hash: string; active: boolean }) {
  const query = useQuery({ queryKey: ['post-media', hash], queryFn: () => getImage(hash), staleTime: 5 * 60_000, retry: false })
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
  return <img src={buildApiUrl(`/api/images/${hash}/${kind === 'animated' && active ? 'file' : 'thumbnail'}`)} alt="" draggable={false} className="size-full object-contain" />
}

function SnsSlide({ post, categories, onOpen, onTag, onVisible }: Omit<ListProps, 'posts'> & { post: PostSummary; onVisible: () => void }) {
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
      if (visible) onVisible()
    }, { threshold: [0, 0.6] })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onVisible])

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
              className="flex size-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
              onScroll={(event) => {
                const target = event.currentTarget
                setIndex(Math.round(target.scrollLeft / Math.max(1, target.clientWidth)))
              }}
            >
              {media.map((item, mediaIndex) => (
                <div key={item.ref} role="button" tabIndex={0} className="size-full shrink-0 cursor-pointer snap-center" onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} aria-label={post.title}>
                  <SnsMedia hash={item.ref} active={active && mediaIndex === index} />
                </div>
              ))}
            </div>
            {media.length > 1 ? (
              <>
                <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm bg-backdrop px-1.5 text-2xs leading-5 text-white"><Images className="size-3" />{index + 1}/{media.length}</span>
                <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
                  {media.map((item, dot) => <span key={item.ref} className={cn('size-1.5 rounded-full', dot === index ? 'bg-white' : 'bg-white/40')} />)}
                </span>
              </>
            ) : null}
          </div>
        ) : (
          <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} className="flex min-h-0 flex-1 cursor-pointer items-center rounded-sm bg-surface-low p-6 text-lg leading-relaxed">
            <span className="line-clamp-[12]">{post.excerpt || post.title}</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div role="button" tabIndex={0} onClick={() => onOpen(post)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(post) }} className="flex min-w-0 cursor-pointer items-center gap-1.5">
            <StatusMarks post={post} />
            <span className="truncate font-semibold">{post.title}</span>
          </div>
          {media.length > 0 && post.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p> : null}
          <div className="flex items-center gap-3">
            <TagRow tags={post.tags} onTag={onTag} />
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onOpen(post)} aria-label={t({ ko: '댓글', en: 'Comments' })}>
              <MessageCircle />{post.commentCount}
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** One post per screen, media first, snapping as you scroll; the last slide asks for more. */
export function PostSns({ posts, categories, onOpen, onTag, onReachEnd }: ListProps & { onReachEnd: () => void }) {
  return (
    <div className="-mx-4 h-[calc(100dvh-8.5rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain px-4 sm:mx-0 sm:px-0">
      {posts.map((post, index) => (
        <SnsSlide key={post.id} post={post} categories={categories} onOpen={onOpen} onTag={onTag} onVisible={index === posts.length - 1 ? onReachEnd : noop} />
      ))}
    </div>
  )
}

const noop = () => undefined
