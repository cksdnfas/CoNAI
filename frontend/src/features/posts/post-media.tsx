import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, ExternalLink, File as FileIcon, ImageOff, Lock, Music, Pause, Play } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { WaveformThumb } from '@/features/audio/audio-waveform'
import { audioPlayer, useAudioPlayer } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { getAudioCandidate } from '@/lib/api-audio'
import { getGroup, getGroupImages } from '@/lib/api-groups'
import { getImage } from '@/lib/api-images'
import { formatFileSize } from '@/lib/api-files'
import { getPostFile, postFileUrl } from '@/lib/api-posts'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { usePostPermissions } from './use-post-permissions'

/** The post being rendered (file embeds are served through it) and every library item it shows, for the lightbox. */
export const PostMediaContext = createContext<{ postId: number | null; mediaHashes: string[] }>({ postId: null, mediaHashes: [] })

/** True once the element has come near the viewport, and whether it is in view right now. */
function useInView<T extends Element>(rootMargin = '200px') {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState({ seen: false, visible: false })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      setState((current) => (current.visible === visible && (current.seen || !visible) ? current : { seen: current.seen || visible, visible }))
    }, { rootMargin })
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin])
  return [ref, state] as const
}

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
 * over every library item of the post.
 */
export function LibraryMedia({ hash, caption, tile = false, autoPlay = true, className }: { hash: string; caption?: string; tile?: boolean; autoPlay?: boolean; className?: string }) {
  const { t } = useI18n()
  const { canViewImages } = usePostPermissions()
  const viewer = useImageViewModal()
  const { mediaHashes } = useContext(PostMediaContext)
  const [ref, view] = useInView<HTMLDivElement>()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const query = useQuery({ queryKey: ['post-media', hash], queryFn: () => getImage(hash), enabled: canViewImages && view.seen, staleTime: 5 * 60_000, retry: false })
  const kind = libraryMediaKind(query.data)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (view.visible && autoPlay) void video.play().catch(() => undefined)
    else video.pause()
  }, [view.visible, autoPlay, kind, query.data])

  if (!canViewImages) return <MediaPlaceholder icon={<Lock className="size-4" />} label={t({ ko: '이미지를 볼 권한이 없어', en: 'No permission to view images' })} className={className} />
  const ratio = query.data?.width && query.data?.height ? `${query.data.width} / ${query.data.height}` : undefined
  const open = () => viewer?.openImageView({ compositeHash: hash, compositeHashes: mediaHashes.includes(hash) ? mediaHashes : [hash] })

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
        <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-backdrop px-1.5 text-2xs font-medium leading-5 text-white">
          {kind === 'video' ? t({ ko: '영상', en: 'Video' }) : t({ ko: '움짤', en: 'GIF' })}
        </span>
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
  const viewer = useImageViewModal()
  const groupQuery = useQuery({ queryKey: ['post-group', groupId], queryFn: () => getGroup(groupId), enabled: canViewImages, staleTime: 5 * 60_000, retry: false })
  const imagesQuery = useQuery({ queryKey: ['post-group-images', groupId], queryFn: () => getGroupImages(groupId, { limit: 9 }), enabled: canViewImages, staleTime: 60_000, retry: false })
  if (!canViewImages) return <MediaPlaceholder icon={<Lock className="size-4" />} label={t({ ko: '이미지를 볼 권한이 없어', en: 'No permission to view images' })} className="my-3" />
  if (groupQuery.isError) return <MediaPlaceholder icon={<ImageOff className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 그룹이야', en: 'Group removed or unavailable' })} className="my-3" />
  const images = (imagesQuery.data?.images ?? []).filter((image) => image.composite_hash)
  const hashes = images.map((image) => image.composite_hash as string)
  const total = imagesQuery.data?.pagination.total ?? images.length
  return (
    <div className="post-media my-3 space-y-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{caption || groupQuery.data?.name || t({ ko: '그룹', en: 'Group' })}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{t({ ko: '{count}장', en: '{count} items' }, { count: total })}</span>
        <span className="flex-1" />
        {total > images.length ? <Link to={`/groups/${groupId}`} className="text-xs text-primary hover:underline">{t({ ko: '더 보기', en: 'See all' })}</Link> : null}
      </div>
      {imagesQuery.isPending ? <span className="block h-40 animate-pulse rounded-sm bg-surface-low" /> : (
        <div className="columns-2 gap-1.5 sm:columns-3">
          {images.map((image) => {
            const hash = image.composite_hash as string
            const kind = libraryMediaKind(image)
            const ratio = image.width && image.height ? `${image.width} / ${image.height}` : undefined
            return (
              <img key={hash} src={kind === 'animated' ? fileUrl(hash) : thumbnailUrl(hash)} alt="" loading="lazy" draggable={false}
                onClick={() => viewer?.openImageView({ compositeHash: hash, compositeHashes: hashes, sourceItems: images })}
                className="mb-1.5 block h-auto w-full cursor-zoom-in break-inside-avoid rounded-sm" style={{ aspectRatio: ratio }} />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A file from the writer's file store, served through the post. */
export function FileEmbed({ fileId, caption }: { fileId: string; caption?: string }) {
  const { t } = useI18n()
  const { postId } = useContext(PostMediaContext)
  const { canViewImages } = usePostPermissions()
  const query = useQuery({ queryKey: ['post-file', postId, fileId], queryFn: () => getPostFile(postId as number, fileId), enabled: postId !== null, staleTime: 5 * 60_000, retry: false })
  if (postId === null) return <MediaPlaceholder icon={<FileIcon className="size-4" />} label={t({ ko: '저장하면 파일이 보여', en: 'The file shows once saved' })} className="my-3 min-h-14 py-3" />
  if (query.isError) return <MediaPlaceholder icon={<FileIcon className="size-4" />} label={t({ ko: '지워졌거나 볼 수 없는 파일이야', en: 'File removed or unavailable' })} className="my-3 min-h-14 py-3" />
  const entry = query.data
  const media = entry?.mimeType?.startsWith('image/') || entry?.mimeType?.startsWith('video/')
  return (
    <div className="my-3 flex items-center gap-3 border-y border-line py-2.5">
      {media && canViewImages && entry ? (
        <img src={postFileUrl(postId, fileId, 'thumbnail')} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-low text-muted-foreground"><FileIcon className="size-5" /></span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <a href={postFileUrl(postId, fileId, 'view')} target="_blank" rel="noreferrer noopener" className="truncate text-sm font-medium hover:underline">{caption || entry?.name || fileId}</a>
        <span className="text-xs text-muted-foreground">{entry ? formatFileSize(entry.size) : ''}</span>
      </div>
      <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '새 탭에서 열기', en: 'Open in new tab' })}>
        <a href={postFileUrl(postId, fileId, 'view')} target="_blank" rel="noreferrer noopener"><ExternalLink /></a>
      </IconButton>
      <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}>
        <a href={postFileUrl(postId, fileId, 'download')} download><Download /></a>
      </IconButton>
    </div>
  )
}
