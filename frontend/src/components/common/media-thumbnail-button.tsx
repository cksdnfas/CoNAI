import { useState } from 'react'
import { Film, ImageIcon, Music2, Play, Square } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { audioPlayer, useAudioPlayerFor } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { useMediaHoverPreview, type MediaHoverPreviewSource } from './media-hover-preview'

export type MediaThumbnailKind = 'image' | 'video' | 'audio'

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music2 } as const

type MediaThumbnailButtonProps = {
  kind: MediaThumbnailKind
  /** Accessible name and tooltip (a file name or description). */
  label: string
  /** A still for images and videos; a failed load (404) shows the kind icon. */
  thumbnailUrl?: string | null
  /** The file itself: the full image or the video stream of the hover preview, the sound of an audio key. */
  fileUrl?: string | null
  /** The app player's key for an audio file (one sound plays at a time). */
  audioKey?: string
  /** Opens the app's media viewer (image and video); without it the square only shows. */
  onOpen?: () => void
}

/**
 * One media file as a small square in a list row. Images and videos show their thumbnail with the PC hover preview (a
 * video plays enlarged) and open the viewer on click or tap, since touch has no hover. Audio is a play / stop key on
 * the app's single player. Without a usable thumbnail (no image permission, a missing file) it is the kind's icon.
 */
export function MediaThumbnailButton(props: MediaThumbnailButtonProps) {
  return props.kind === 'audio' ? <AudioThumbnail {...props} /> : <VisualThumbnail {...props} />
}

function VisualThumbnail({ kind, label, thumbnailUrl, fileUrl, onOpen }: MediaThumbnailButtonProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const thumbnail = thumbnailUrl && failedUrl !== thumbnailUrl ? thumbnailUrl : null
  const source: MediaHoverPreviewSource | null = thumbnail
    ? { src: thumbnail, fullSrc: kind === 'image' ? fileUrl ?? null : null, videoSrc: kind === 'video' ? fileUrl ?? null : null, caption: label }
    // A video without a still can still play in the preview; its box comes from the stream's own size.
    : kind === 'video' && fileUrl ? { src: '', videoSrc: fileUrl, caption: label } : null
  const hoverPreview = useMediaHoverPreview(source)
  const Icon = KIND_ICON[kind]
  const content = <>
    {thumbnail ? <img src={thumbnail} alt="" loading="lazy" draggable={false} className="size-full object-cover" onError={() => setFailedUrl(thumbnail)} /> : <Icon className="size-4" />}
    {kind === 'video' && thumbnail ? <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-backdrop/50"><Play className="size-2.5 fill-white text-white" /></span> : null}
  </>
  return (
    <>
      {onOpen ? (
        // With a hover preview its caption names the file, so the tooltip would say the same thing twice.
        <IconButton variant="subtle" size="icon" className="relative overflow-hidden" label={label} tooltip={!source} onClick={onOpen} {...hoverPreview.triggerProps}>
          {content}
        </IconButton>
      ) : (
        <Tip content={source ? null : label}>
          <span aria-label={label} role="img" className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-low text-muted-foreground" {...hoverPreview.triggerProps}>
            {content}
          </span>
        </Tip>
      )}
      {hoverPreview.preview}
    </>
  )
}

function AudioThumbnail({ label, fileUrl, audioKey }: MediaThumbnailButtonProps) {
  const { t } = useI18n()
  const player = useAudioPlayerFor(audioKey ?? '')
  const playing = Boolean(audioKey) && player.playing
  return (
    <IconButton
      variant="subtle"
      size="icon"
      active={playing}
      disabled={!fileUrl || !audioKey}
      label={playing ? t({ ko: '{name} 멈추기', en: 'Stop {name}' }, { name: label }) : t({ ko: '{name} 듣기', en: 'Play {name}' }, { name: label })}
      onClick={() => {
        if (!fileUrl || !audioKey) return
        if (playing) audioPlayer.stop()
        else audioPlayer.play(audioKey, { src: fileUrl, start: 0 })
      }}
    >
      {playing ? <Square className="fill-current" /> : <Music2 />}
    </IconButton>
  )
}
