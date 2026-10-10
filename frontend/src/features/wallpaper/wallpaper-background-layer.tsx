import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { buildApiUrl } from '@/lib/api-client'
import type { ImageRecord } from '@/types/image'
import type { WallpaperBackground, WallpaperBackgroundFit } from './wallpaper-types'
import { useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import { useWallpaperRotatingIndex } from './wallpaper-widget-utils'

const SLIDESHOW_POOL_SIZE = 40

function mediaUrl(path: string | null | undefined) {
  if (!path) return null
  return path.startsWith('/') ? buildApiUrl(path) : path
}

function isVideoRecord(image: ImageRecord) {
  return (image.mime_type ?? '').toLowerCase().startsWith('video/')
}

function MediaFill({ src, poster, video, fit, blur, style }: { src: string; poster?: string | null; video: boolean; fit: WallpaperBackgroundFit; blur: number; style?: CSSProperties }) {
  const filter = blur > 0 ? `blur(${blur}px)` : undefined
  const media = (objectFit: 'cover' | 'contain', extra?: CSSProperties) => (video ? (
    <video
      src={src}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      className="absolute inset-0 h-full w-full"
      style={{ objectFit, filter, ...extra }}
    />
  ) : (
    <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" style={{ objectFit, filter, ...extra }} />
  ))

  return (
    <div className="absolute inset-0 overflow-hidden" style={style}>
      {fit === 'blur-fill' ? (
        <>
          {media('cover', { filter: `blur(${Math.max(24, blur)}px) brightness(0.7)`, transform: 'scale(1.1)' })}
          {media('contain')}
        </>
      ) : media(fit)}
    </div>
  )
}

/** Cross-fading slideshow of one group, refreshed from the server every few rounds. */
function GroupSlideshow({ background }: { background: Extract<WallpaperBackground, { kind: 'group-slideshow' }> }) {
  const intervalMs = Math.max(10, background.intervalSec) * 1000
  // Draw a fresh pool roughly once all of the current one has been shown.
  const poolMinutes = Math.max(5, Math.round((intervalMs * SLIDESHOW_POOL_SIZE) / 60_000))
  const poolQuery = useWallpaperGroupPreviewImagesQuery('background', background.groupId, background.includeChildren, SLIDESHOW_POOL_SIZE, poolMinutes)
  const images = poolQuery.data ?? []
  const index = useWallpaperRotatingIndex(images.length, intervalMs, images.length > 1)
  const current = images[index] ?? null
  const [layers, setLayers] = useState<Array<{ key: string; image: ImageRecord }>>([])

  useEffect(() => {
    if (!current) return
    const key = String(current.composite_hash ?? current.id)
    // Preload before swapping so the fade never shows a half-loaded frame.
    const url = mediaUrl(current.image_url ?? current.thumbnail_url)
    if (!url || isVideoRecord(current)) {
      setLayers((previous) => [...previous.slice(-1), { key, image: current }])
      return
    }
    const loader = new Image()
    loader.onload = () => setLayers((previous) => (previous[previous.length - 1]?.key === key ? previous : [...previous.slice(-1), { key, image: current }]))
    loader.src = url
  }, [current])

  const transition = background.transition
  return (
    <>
      {layers.map((layer, layerIndex) => {
        const isTop = layerIndex === layers.length - 1
        const url = mediaUrl(layer.image.image_url ?? layer.image.thumbnail_url)
        if (!url) return null
        const enter = transition === 'zoom'
          ? 'wallpaper-bg-zoom 1600ms cubic-bezier(0.22, 1, 0.36, 1) both'
          : transition === 'slide'
            ? 'wallpaper-bg-slide 1200ms cubic-bezier(0.22, 1, 0.36, 1) both'
            : 'wallpaper-enter-fade 1400ms ease both'
        return (
          <MediaFill
            key={layer.key}
            src={url}
            poster={mediaUrl(layer.image.thumbnail_url)}
            video={isVideoRecord(layer.image)}
            fit={background.fit}
            blur={background.blur ?? 0}
            style={isTop && layers.length > 1 ? { animation: enter } : undefined}
          />
        )
      })}
    </>
  )
}

export const WALLPAPER_BACKGROUND_KEYFRAMES = `
@keyframes wallpaper-bg-zoom { from { opacity: 0; transform: scale(1.08) } to { opacity: 1; transform: none } }
@keyframes wallpaper-bg-slide { from { opacity: 0; transform: translateX(6%) } to { opacity: 1; transform: none } }
`

/** The wallpaper's own background, under every widget. */
export function WallpaperBackgroundLayer({ background }: { background: WallpaperBackground }) {
  const blur = background.blur ?? 0
  let content: ReactNode
  switch (background.kind) {
    case 'color':
      content = <div className="absolute inset-0" style={{ background: background.color }} />
      break
    case 'gradient':
      content = <div className="absolute inset-0" style={{ background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` }} />
      break
    case 'image':
    case 'video':
      content = background.compositeHash ? (
        <MediaFill
          src={buildApiUrl(`/api/images/${background.compositeHash}/file`)}
          poster={buildApiUrl(`/api/images/${background.compositeHash}/thumbnail`)}
          video={background.kind === 'video'}
          fit={background.fit}
          blur={blur}
        />
      ) : null
      break
    case 'group-slideshow':
      content = background.groupId !== null ? <GroupSlideshow background={background} /> : null
      break
    default:
      content = null
  }

  const dim = background.dim ?? 0
  const vignette = background.vignette ?? 0
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-background">
      {content}
      {dim > 0 ? <div className="absolute inset-0" style={{ background: `rgb(0 0 0 / ${dim / 100})` }} /> : null}
      {vignette > 0 ? (
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgb(0 0 0 / ${(vignette / 100) * 0.85}) 100%)` }}
        />
      ) : null}
    </div>
  )
}
