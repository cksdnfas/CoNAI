import { useRef, useState, type DragEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, FolderOpen, Images, Loader2, Trash2, Upload, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { useI18n } from '@/i18n'
import { uploadMultipleImages } from '@/lib/api-images'
import { getSpriteVideoInfo, libraryThumbnailUrl, type SpriteBatchItem } from '@/lib/api-sprite'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

export const MAX_QUEUE_VIDEOS = 100

const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo' }

/** Browsers send .mkv/.avi without a type; the library upload needs one, so it is filled in from the extension. */
function asVideoFile(file: File): File | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type.startsWith('video/')) return file
  const type = VIDEO_TYPES[extension]
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null
}

/** Every file of a drop, walking into dropped folders. */
async function droppedFiles(event: DragEvent): Promise<File[]> {
  const entries = [...event.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry))
  if (!entries.length) return [...event.dataTransfer.files]
  const files: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (files.length >= MAX_QUEUE_VIDEOS * 4) return
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)))
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await walk(child)
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}

/**
 * The videos of this run. One or many: the same settings go to all of them; a click picks the one to preview. Files and
 * folders dropped here go into the library first (the usual upload), then join the list.
 */
export function SpriteQueue({ hashes, selected, statuses, locked, onSelect, onChange }: {
  hashes: string[]
  selected: string | null
  statuses: Map<string, SpriteBatchItem>
  locked: boolean
  onSelect: (hash: string) => void
  onChange: (hashes: string[]) => void
}) {
  const { t } = useI18n()
  const { has } = useFeaturePermissions()
  const { showSnackbar } = useSnackbar()
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canUpload = has('images.upload')
  const infos = useQueries({ queries: hashes.map((hash) => ({ queryKey: ['sprite-video-info', hash], queryFn: () => getSpriteVideoInfo(hash), retry: false, staleTime: 5 * 60_000 })) })

  const append = (next: string[]) => {
    const merged = [...hashes, ...next.filter((hash) => !hashes.includes(hash))]
    if (merged.length > MAX_QUEUE_VIDEOS) showSnackbar({ tone: 'error', message: t({ ko: '영상은 {max}개까지야.', en: 'Up to {max} videos.' }, { max: MAX_QUEUE_VIDEOS }) })
    onChange(merged.slice(0, MAX_QUEUE_VIDEOS))
  }

  const upload = async (raw: File[]) => {
    const files = raw.map(asVideoFile).filter((file): file is File => Boolean(file)).slice(0, MAX_QUEUE_VIDEOS - hashes.length)
    if (!files.length) {
      if (raw.length) showSnackbar({ tone: 'error', message: t({ ko: '영상 파일이 없어.', en: 'No video files.' }) })
      return
    }
    setUploading(files.length)
    try {
      const outcome = await uploadMultipleImages(files)
      if (outcome.failed.length) showSnackbar({ tone: 'error', message: outcome.failed.map((failure) => failure.error).join(', ') })
      append(outcome.uploaded.flatMap((item) => item.composite_hash ? [item.composite_hash] : []))
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '업로드하지 못했어.', en: 'Upload failed.' })) })
    } finally {
      setUploading(0)
    }
  }

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (locked || !canUpload) return
    await upload(await droppedFiles(event))
  }

  return (
    <section
      aria-label={t({ ko: '영상 목록', en: 'Videos' })}
      className="flex min-w-0 flex-col gap-2.5"
      onDragOver={(event) => { if (!locked && canUpload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false) }}
      onDrop={(event) => void onDrop(event)}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t({ ko: '영상', en: 'Videos' })} <span className="font-mono font-normal text-muted-foreground">{hashes.length}</span></h2>
        <div className="flex items-center gap-0.5">
          <IconButton variant="ghost" size="icon-sm" disabled={locked} label={t({ ko: '라이브러리에서 영상 고르기', en: 'Choose videos from the library' })} onClick={() => setPicking(true)}><Images /></IconButton>
          {canUpload ? <IconButton variant="ghost" size="icon-sm" disabled={locked || uploading > 0} label={t({ ko: '영상 올리기', en: 'Upload videos' })} onClick={() => inputRef.current?.click()}><Upload /></IconButton> : null}
          <IconButton variant="ghost" size="icon-sm" disabled={locked || hashes.length === 0} label={t({ ko: '목록 비우기', en: 'Clear the list' })} onClick={() => onChange([])}><Trash2 /></IconButton>
        </div>
      </div>
      {canUpload ? (
        <div className={cn('flex h-14 items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground transition-colors', dragOver ? 'border-primary bg-primary/10 text-foreground' : 'border-line')}>
          {uploading > 0 ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
          {uploading > 0 ? t({ ko: '{count}개 올리는 중', en: 'Uploading {count}' }, { count: uploading }) : t({ ko: '영상·폴더를 끌어다 놓기', en: 'Drop videos or folders' })}
        </div>
      ) : null}
      <input ref={inputRef} type="file" hidden multiple accept="video/*,.mkv,.mov,.webm,.avi,.mp4,.m4v" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void upload(files) }} />
      <ul className="flex flex-col">
        {hashes.map((hash, index) => {
          const info = infos[index]?.data
          const status = statuses.get(hash)
          return (
            <li key={hash} className="group relative">
              <ListRow
                asChild
                interactive
                selected={hash === selected}
                className="gap-2.5 rounded-sm"
                leading={<img src={libraryThumbnailUrl(hash)} alt="" loading="lazy" className="size-11 rounded-sm object-cover" />}
                trailing={<QueueStatus status={status} />}
              >
                <button type="button" onClick={() => onSelect(hash)} aria-current={hash === selected}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm">{info?.name ?? hash.slice(0, 12)}</span>
                  {status?.status === 'failed' ? (
                    <span className="truncate text-xs text-destructive">{status.error}</span>
                  ) : (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {status?.status === 'done' && status.frameCount ? t({ ko: '{count}컷', en: '{count} frames' }, { count: status.frameCount }) : info ? `${info.duration.toFixed(1)}s · ${info.width}×${info.height}` : infos[index]?.isError ? t({ ko: '읽지 못함', en: 'Unreadable' }) : ''}
                    </span>
                  )}
                </span>
                </button>
              </ListRow>
              {!locked ? (
                <IconButton size="icon-xs" variant="secondary" className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" label={t({ ko: '목록에서 빼기', en: 'Remove from the list' })} onClick={() => onChange(hashes.filter((item) => item !== hash))}><X /></IconButton>
              ) : null}
            </li>
          )
        })}
      </ul>
      {picking ? (
        <ChatMediaPicker
          initial={[]}
          maxCount={Math.max(1, MAX_QUEUE_VIDEOS - hashes.length)}
          videosOnly
          title={t({ ko: '영상 고르기', en: 'Choose videos' })}
          applyLabel={t({ ko: '넣기', en: 'Add' })}
          note={null}
          onClose={() => setPicking(false)}
          onPick={(items) => { setPicking(false); append(items.map((item) => item.compositeHash)) }}
        />
      ) : null}
    </section>
  )
}

function QueueStatus({ status }: { status?: SpriteBatchItem }) {
  const { t } = useI18n()
  if (!status) return null
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium'
  if (status.status === 'done') return <span className={cn(base, 'bg-success/15 text-success')}><Check className="size-3" />{t({ ko: '완료', en: 'Done' })}</span>
  if (status.status === 'failed') return <span className={cn(base, 'bg-destructive/15 text-destructive')}>{t({ ko: '실패', en: 'Failed' })}</span>
  if (status.status === 'running') return <span className={cn(base, 'bg-primary/15 text-primary')}><Loader2 className="size-3 animate-spin" />{t({ ko: '진행', en: 'Running' })}</span>
  if (status.status === 'skipped') return <span className={cn(base, 'bg-fill text-muted-foreground')}>{t({ ko: '건너뜀', en: 'Skipped' })}</span>
  return <span className={cn(base, 'bg-fill text-muted-foreground')}>{t({ ko: '대기', en: 'Waiting' })}</span>
}
