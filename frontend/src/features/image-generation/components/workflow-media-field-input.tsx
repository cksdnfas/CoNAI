import { useRef, useState } from 'react'
import { AudioLines, Film, LoaderCircle, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { MediaFileDropSurface } from '@/components/media/media-file-drop-surface'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { audioPlayer, useAudioPlayerFor } from '@/features/audio/audio-player'
import { WaveformThumb } from '@/features/audio/audio-waveform'
import { useDropZoneState } from '@/features/upload/use-drop-zone-state'
import { useI18n } from '@/i18n'
import {
  buildWorkflowInputAssetUrl,
  deleteWorkflowInputAsset,
  readableUploadName,
  uploadWorkflowInputAsset,
  WORKFLOW_INPUT_ASSET_REF_KIND,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'

export type WorkflowMediaFieldKind = 'audio' | 'video'

/** An uploaded audio/video field value: a reference into the workflow input store. */
export function isWorkflowInputAssetRefValue(value: unknown): value is WorkflowInputAssetRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.__ref === WORKFLOW_INPUT_ASSET_REF_KIND && typeof record.id === 'string' && typeof record.fileName === 'string'
}

/** Whether the file can go into a field of this kind; a video file also serves as an audio source. */
function acceptsFile(kind: WorkflowMediaFieldKind, file: File) {
  if (file.type.startsWith(`${kind}/`)) return true
  if (kind === 'audio' && file.type.startsWith('video/')) return true
  return !file.type && (kind === 'audio' ? /\.(aac|aiff?|flac|m4a|mp3|oga|ogg|opus|wav|weba|wma)$/i : /\.(avi|m4v|mkv|mov|mp4|mpe?g|webm|wmv)$/i).test(file.name)
}

type WorkflowMediaFieldInputProps = {
  kind: WorkflowMediaFieldKind
  value: WorkflowInputAssetRef | null
  label: string
  invalid?: boolean
  errorMessageId?: string
  onChange: (value: WorkflowInputAssetRef | '') => void
}

/** Audio/video marked field: upload one file into the workflow input store, preview it, replace or remove it. */
export function WorkflowMediaFieldInput({ kind, value, label, invalid = false, errorMessageId, onChange }: WorkflowMediaFieldInputProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const kindLabel = kind === 'audio' ? t({ ko: '오디오', en: 'audio' }) : t({ ko: '비디오', en: 'video' })

  const upload = async (file: File | null) => {
    if (!file || isUploading) return
    if (!acceptsFile(kind, file)) {
      showSnackbar({ message: t({ ko: '{kind} 파일만 넣을 수 있어.', en: 'Only {kind} files can be attached.' }, { kind: kindLabel }), tone: 'error' })
      return
    }
    setIsUploading(true)
    try {
      const asset = await uploadWorkflowInputAsset(file)
      const previous = value
      onChange(asset)
      if (previous) {
        if (audioPlayer.state.key === previous.id) audioPlayer.stop()
        void deleteWorkflowInputAsset(previous.id).catch(() => undefined)
      }
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '파일을 올리지 못했어.', en: 'Could not upload the file.' }), tone: 'error' })
    } finally {
      setIsUploading(false)
    }
  }

  const remove = () => {
    if (!value) return
    if (audioPlayer.state.key === value.id) audioPlayer.stop()
    void deleteWorkflowInputAsset(value.id).catch(() => undefined)
    onChange('')
  }

  const dropZone = useDropZoneState<HTMLButtonElement>({
    onDropFiles: (files) => void upload(files.find((file) => acceptsFile(kind, file)) ?? files[0] ?? null),
  })
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={kind === 'audio' ? 'audio/*,video/*' : 'video/*'}
      hidden
      onChange={(event) => { void upload(event.target.files?.[0] ?? null); event.target.value = '' }}
    />
  )
  const Icon = isUploading ? LoaderCircle : kind === 'audio' ? AudioLines : Film

  if (!value) {
    return (
      <>
        {fileInput}
        <div aria-invalid={invalid || undefined} aria-describedby={errorMessageId} className={invalid ? 'rounded-sm ring-1 ring-destructive' : undefined}>
          <MediaFileDropSurface
            ariaLabel={t({ ko: '{label} 업로드', en: 'Upload {label}' }, { label })}
            active={dropZone.isDragActive}
            disabled={isUploading}
            contentClassName="min-h-24"
            onClick={() => inputRef.current?.click()}
            onDrop={dropZone.handleDrop}
            onDragEnter={dropZone.handleDragEnter}
            onDragOver={dropZone.handleDragOver}
            onDragLeave={dropZone.handleDragLeave}
          >
            <Icon className={isUploading ? 'h-8 w-8 animate-spin text-muted-foreground' : dropZone.isDragActive ? 'h-8 w-8 text-primary-text' : 'h-8 w-8 text-muted-foreground'} />
          </MediaFileDropSurface>
        </div>
      </>
    )
  }

  const src = buildWorkflowInputAssetUrl(value)
  return (
    <div className="space-y-2">
      {fileInput}
      {kind === 'video' ? (
        <video src={src} controls preload="metadata" className="max-h-64 w-full rounded-sm bg-black" />
      ) : (
        <WorkflowAudioPreview asset={value} src={src} />
      )}
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">{readableUploadName(value.fileName)}</span>
        <IconButton size="icon-sm" variant="ghost" disabled={isUploading} onClick={() => inputRef.current?.click()} label={t({ ko: '{kind} 바꾸기', en: 'Replace {kind}' }, { kind: kindLabel })}>
          {isUploading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" disabled={isUploading} onClick={remove} label={t({ ko: '{kind} 빼기', en: 'Remove {kind}' }, { kind: kindLabel })}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  )
}

/** The uploaded sound on the app's one audio player: play button and a waveform that seeks. */
function WorkflowAudioPreview({ asset, src }: { asset: WorkflowInputAssetRef; src: string }) {
  const { t } = useI18n()
  const player = useAudioPlayerFor(asset.id)
  const active = player.key === asset.id
  const playing = active && player.playing
  return (
    <div className="flex min-w-0 items-center gap-3">
      <IconButton variant={playing ? 'secondary' : 'ghost'} size="icon-sm" className="shrink-0" label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(asset.id, { src })}>
        {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </IconButton>
      <WaveformThumb
        candidateId={asset.id}
        fileHash={asset.id}
        src={src}
        progress={active && player.duration > 0 ? player.currentTime / player.duration : undefined}
        duration={active ? player.duration : 0}
        onToggle={() => audioPlayer.toggle(asset.id, { src })}
        onSeek={(seconds) => audioPlayer.seekOrPlay(asset.id, seconds, { src })}
        className="h-10 min-w-0 flex-1"
      />
    </div>
  )
}
