import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { PostMediaRef } from '@conai/shared'
import { Download, ExternalLink, File as FileIcon, FileText, ImageOff, Lock, Music, Pause, Play } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { WaveformThumb } from '@/features/audio/audio-waveform'
import { audioPlayer, useAudioPlayer } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { getAudioCandidate } from '@/lib/api-audio'
import { getGroup, getGroupImages } from '@/lib/api-groups'
import { getImage } from '@/lib/api-images'
import { formatFileSize } from '@/lib/format-size'
import { getPost, getPostFile, POSTS_QUERY_KEY, postFileUrl } from '@/lib/api-posts'
import { buildApiUrl } from '@/lib/api-url'
import { useInView } from '@/lib/use-in-view'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { postRoute } from './post-links'
import { usePostPermissions } from './use-post-permissions'

/** The first library item or group a post embeds, as a still cover. */
export function postCoverUrl(media: PostMediaRef[]) {
  const first = media.find((item) => item.kind === 'media' || item.kind === 'group')
  if (!first) return null
  return buildApiUrl(first.kind === 'media' ? `/api/images/${first.ref}/thumbnail` : `/api/groups/${first.ref}/thumbnail`)
}

/** The post being rendered (file embeds are served through it) and every library item it shows, for the lightbox. */
export const PostMediaContext = createContext<{ postId: number | null; mediaHashes: string[]; knowledgeContentVersion?: number }>({ postId: null, mediaHashes: [] })

/** How a library item is shown: animated images and videos use the original so they move. */
export function libraryMediaKind(record: Pick<ImageRecord, 'mime_type' | 'file_type'> | null | undefined): 'image' | 'animated' | 'video' {
  const mime = record?.mime_type?.toLowerCase() ?? ''
  if (mime.startsWith('video/')) return 'video'
  // WebP is stored as a still even when it moves (only GIF / APNG are typed animated); a post body loads originals, so it still plays there.
  if (mime === 'image/gif' || mime === 'image/apng' || record?.file_type === 'animated') return 'animated'
  return 'image'
}

const fileUrl = (hash: string) => buildApiUrl(`/api/images/${hash}/file`)
const thumbnailUrl = (hash: string) => buildApiUrl(`/api/images/${hash}/thumbnail`)

function MediaPlaceholder({ icon, label, className }: { icon: ReactNode; label: string; className?: string }) {
  return (
    <span className={cn('flex min-h-24 w-full items-center justify-center gap-2 rounded-sm bg-surface-low px-3 py-6 text-xs text-muted-foreground', className)}>
      {icon}
      {label}
    </span>
  )
}

/**
 * One library item. Videos and animated images play muted on a loop while on screen; a click opens the lightbox
 * over every library item of the post (or over `gallery` when the caller already listed its items, e.g. a group).
 */
export function LibraryMedia({ hash, caption, tile = false, autoPlay = true, className, record, gallery }: {
  hash: string; caption?: string; tile?: boolean; autoPlay?: boolean; className?: string
  record?: ImageRecord; gallery?: { hashes: string[]; items: ImageRecord[] }
}) {
  const { t } = useI18n()
  const { canViewImages } = usePostPermissions()
  const viewer = useImageViewModal()
  const { mediaHashes } = useContext(PostMediaContext)
  const [ref, view] = useInView<HTMLDivElement>()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fetched = useQuery({ queryKey: ['post-media', hash], queryFn: () => getImage(hash), enabled: canViewImages && view.seen && !record, staleTime: 5 * 60_000, retry: false })
  const query = record ? { data: record, isError: false } : fetched
  const kind = libraryMediaKind(query.data)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (view.visible && autoPlay) void video.play().catch(() => undefined)
    else video.pause()
  }, [view.visible, autoPlay, kind, query.data])

  if (!canViewImages) return <MediaPlaceholder icon={<Lock className="size-4" />} label={t({ ko: '이미지를 볼 권한이 없어', en: 'No permission to view images' })} className={className} />
  const ratio = query.data?.width && query.data?.height ? `${query.data.width} / ${query.data.height}` : undefined
  const open = () => viewer?.openImageView(gallery
    ? { compositeHash: hash, compositeHashes: gallery.hashes, sourceItems: gallery.items }
    : { compositeHash: hash, compositeHashes: mediaHashes.includes(hash) ? mediaHashes : [hash] })

  let body: ReactNode
  if (query.isError) body = <MediaPlaceholder icon={<ImageOff className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 미디어야', en: 'Media removed or unavailable' })} />
  else if (!query.data) body = <span className="block w-full animate-pulse rounded-sm bg-surface-low" style={{ aspectRatio: ratio ?? '4 / 3' }} />
  else if (kind === 'video') {
    body = (
      <video
        ref={videoRef}
        src={view.seen ? fileUrl(hash) : undefined}
        poster={thumbnailUrl(hash)}
        muted
        loop
        playsInline
        preload="metadata"
        onClick={open}
        className="block h-auto w-full cursor-zoom-in rounded-sm bg-black"
        style={{ aspectRatio: ratio }}
      />
    )
  } else {
    // Thumbnails are still frames, so anything that moves loads its original; still images take the thumbnail in a gallery.
    const src = kind === 'animated' || !tile ? fileUrl(hash) : thumbnailUrl(hash)
    body = <img src={src} alt={caption ?? ''} loading="lazy" draggable={false} onClick={open} className="block h-auto w-full cursor-zoom-in rounded-sm" style={{ aspectRatio: ratio }} />
  }

  return (
    <div ref={ref} className={cn('relative', !tile && 'post-media max-w-full', className)}>
      {body}
      {query.data && kind !== 'image' ? (
        <Badge variant="overlay" size="sm" className="pointer-events-none absolute top-2 left-2">
          {kind === 'video' ? t({ ko: '영상', en: 'Video' }) : t({ ko: '움짤', en: 'GIF' })}
        </Badge>
      ) : null}
      {caption && !tile ? <span className="mt-1 block text-xs text-muted-foreground">{caption}</span> : null}
    </div>
  )
}

/** Several library items in a row of the body: a masonry gallery. */
export function MediaGallery({ items }: { items: Array<{ hash: string; caption?: string }> }) {
  return (
    <div className={cn('post-media my-3 gap-1.5', items.length === 2 ? 'columns-2' : 'columns-2 sm:columns-3')}>
      {items.map((item, index) => (
        <LibraryMedia key={`${item.hash}-${index}`} hash={item.hash} caption={item.caption} tile className="mb-1.5 break-inside-avoid" />
      ))}
    </div>
  )
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** An audio take: play button, waveform, length. */
export function AudioEmbed({ candidateId, caption }: { candidateId: string; caption?: string }) {
  const { t } = useI18n()
  const { canViewAudio } = usePostPermissions()
  const player = useAudioPlayer()
  const query = useQuery({ queryKey: ['post-audio', candidateId], queryFn: () => getAudioCandidate(candidateId), enabled: canViewAudio, staleTime: 5 * 60_000, retry: false })
  if (!canViewAudio) return <MediaPlaceholder icon={<Lock className="size-4" />} label={t({ ko: '오디오를 들을 권한이 없어', en: 'No permission to play audio' })} className="my-3 min-h-14 py-3" />
  if (query.isError) return <MediaPlaceholder icon={<Music className="size-4" />} label={t({ ko: '지워졌거나 들을 수 없는 오디오야', en: 'Audio removed or unavailable' })} className="my-3 min-h-14 py-3" />
  const candidate = query.data
  const playing = player.key === candidateId && player.playing
  const progress = player.key === candidateId && player.duration > 0 ? player.currentTime / player.duration : undefined
  return (
    <div className="my-3 flex items-center gap-3 border-y border-line py-2.5">
      <IconButton variant="secondary" size="icon" className="rounded-full" disabled={!candidate} label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(candidateId)}>
        {playing ? <Pause /> : <Play />}
      </IconButton>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{caption || candidate?.name || t({ ko: '오디오', en: 'Audio' })}</span>
        {candidate ? <WaveformThumb candidateId={candidateId} fileHash={candidate.file_hash} progress={progress} className="h-7 w-full" /> : <span className="h-7 w-full animate-pulse rounded-sm bg-surface-low" />}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(candidate?.file.duration)}</span>
    </div>
  )
}

/** An image group: its name and a masonry of its first images; the rest is a click away. */
export function GroupEmbed({ groupId, caption }: { groupId: number; caption?: string }) {
  const { t } = useI18n()
  const { canViewImages } = usePostPermissions()
  const groupQuery = useQuery({ queryKey: ['post-group', groupId], queryFn: () => getGroup(groupId), enabled: canViewImages, staleTime: 5 * 60_000, retry: false })
  // Subgroups included: the picker shows the subtree count, and a parent group often holds nothing directly.
  const imagesQuery = useQuery({ queryKey: ['post-group-images', groupId, 'subtree'], queryFn: () => getGroupImages(groupId, { limit: 9, includeChildren: true }), enabled: canViewImages, staleTime: 60_000, retry: false })
  if (!canViewImages) return <MediaPlaceholder icon={<Lock className="size-4" />} label={t({ ko: '이미지를 볼 권한이 없어', en: 'No permission to view images' })} className="my-3" />
  if (groupQuery.isError) return <MediaPlaceholder icon={<ImageOff className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 그룹이야', en: 'Group removed or unavailable' })} className="my-3" />
  const images = (imagesQuery.data?.images ?? []).filter((image) => image.composite_hash)
  const gallery = { hashes: images.map((image) => image.composite_hash as string), items: images }
  const total = imagesQuery.data?.pagination.total ?? images.length
  return (
    <div className="post-media my-3 space-y-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{caption || groupQuery.data?.name || t({ ko: '그룹', en: 'Group' })}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{t({ ko: '{count}개', en: '{count} items' }, { count: total })}</span>
        <span className="flex-1" />
        {total > images.length ? <Link to={`/groups/${groupId}`} className="text-xs text-primary hover:underline">{t({ ko: '더 보기', en: 'See all' })}</Link> : null}
      </div>
      {imagesQuery.isPending ? <span className="block h-40 animate-pulse rounded-sm bg-surface-low" /> : (
        // Videos go through LibraryMedia too: an <img> on a video's thumbnail URL renders nothing until a poster exists.
        <div className="columns-2 gap-1.5 sm:columns-3">
          {images.map((image) => (
            <LibraryMedia key={image.composite_hash} hash={image.composite_hash as string} record={image} gallery={gallery} tile className="mb-1.5 break-inside-avoid" />
          ))}
        </div>
      )}
    </div>
  )
}

/** A file from the writer's file store, served through the post. */
export function FileEmbed({ fileId, caption }: { fileId: string; caption?: string }) {
  const { t } = useI18n()
  const { postId, knowledgeContentVersion } = useContext(PostMediaContext)
  const { canViewImages } = usePostPermissions()
  const query = useQuery({ queryKey: ['post-file', postId, knowledgeContentVersion ?? 'current', fileId], queryFn: () => getPostFile(postId as number, fileId, knowledgeContentVersion), enabled: postId !== null, staleTime: 5 * 60_000, retry: false })
  if (postId === null) return <MediaPlaceholder icon={<FileIcon className="size-4" />} label={t({ ko: '저장하면 파일이 보여', en: 'The file shows once saved' })} className="my-3 min-h-14 py-3" />
  if (query.isError) return <MediaPlaceholder icon={<FileIcon className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 파일이야', en: 'File removed or unavailable' })} className="my-3 min-h-14 py-3" />
  const entry = query.data
  const media = entry?.mimeType?.startsWith('image/') || entry?.mimeType?.startsWith('video/')
  return (
    <div className="my-3 flex items-center gap-3 border-y border-line py-2.5">
      {media && canViewImages && entry ? (
        <img src={postFileUrl(postId, fileId, 'thumbnail', knowledgeContentVersion)} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-low text-muted-foreground"><FileIcon className="size-5" /></span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <a href={postFileUrl(postId, fileId, 'view', knowledgeContentVersion)} target="_blank" rel="noreferrer noopener" className="truncate text-sm font-medium hover:underline">{caption || entry?.name || fileId}</a>
        <span className="text-xs text-muted-foreground">{entry ? formatFileSize(entry.size) : ''}</span>
      </div>
      <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '새 탭에서 열기', en: 'Open in new tab' })}>
        <a href={postFileUrl(postId, fileId, 'view', knowledgeContentVersion)} target="_blank" rel="noreferrer noopener"><ExternalLink /></a>
      </IconButton>
      <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}>
        <a href={postFileUrl(postId, fileId, 'download', knowledgeContentVersion)} download><Download /></a>
      </IconButton>
    </div>
  )
}

/** Another post as a small card: cover thumbnail, then its title and the first lines of its text. */
export function PostCardEmbed({ postId, caption }: { postId: number; caption?: string }) {
  const { t } = useI18n()
  const { canViewImages } = usePostPermissions()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'card', postId], queryFn: () => getPost(postId), staleTime: 5 * 60_000, retry: false })
  const [coverFailed, setCoverFailed] = useState(false)
  if (query.isError) return <MediaPlaceholder icon={<FileText className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 글이야', en: 'Post removed or unavailable' })} className="my-3 min-h-14 max-w-xl py-3" />
  const post = query.data
  const cover = post && canViewImages && !coverFailed ? postCoverUrl(post.media) : null
  return (
    <Link to={postRoute({ postId, commentId: null })} className="my-3 flex max-w-xl items-center gap-3 rounded-sm border border-line p-2 no-underline transition-colors hover:bg-surface-low">
      {cover ? <img src={cover} alt="" loading="lazy" draggable={false} onError={() => setCoverFailed(true)} className="h-16 w-20 shrink-0 rounded-sm object-cover" />
        : <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-sm bg-surface-low text-muted-foreground"><FileText className="size-5" /></span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {post ? <>
          <span className="truncate text-sm font-medium text-foreground">{post.title || caption}</span>
          {post.excerpt ? <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{post.excerpt}</span> : null}
        </> : <>
          <span className="h-4 w-1/2 animate-pulse rounded-sm bg-surface-low" />
          <span className="h-3 w-4/5 animate-pulse rounded-sm bg-surface-low" />
        </>}
      </span>
    </Link>
  )
}
