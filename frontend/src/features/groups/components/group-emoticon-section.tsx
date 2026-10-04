import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw, Smile } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState, Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { addGroupEmoticons, getGroupEmoticons, groupEmoticonsQueryKey, setGroupEmoticonKeywords } from '@/lib/api-groups'
import { uploadMultipleImages } from '@/lib/api-images'
import { buildApiUrl } from '@/lib/api-url'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { EmoticonEntry, GroupRecord } from '@/types/group'

function parseKeywords(value: string) {
  const seen = new Set<string>()
  return value.split(/[,，]/).map((word) => word.trim()).filter((word) => {
    const key = word.toLowerCase()
    if (!word || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const UPLOAD_BATCH_FILES = 20
const UPLOAD_BATCH_BYTES = 900 * 1024 * 1024

/** Splits files into requests the upload endpoint accepts (20 files, under 1 GB). */
function uploadBatches(files: File[]) {
  const batches: File[][] = []
  let current: File[] = []
  let bytes = 0
  for (const file of files) {
    if (current.length >= UPLOAD_BATCH_FILES || (current.length > 0 && bytes + file.size > UPLOAD_BATCH_BYTES)) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(file)
    bytes += file.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** Animated images play from the original; stills use the thumbnail. */
function emoticonSrc(entry: EmoticonEntry) {
  const animated = entry.mimeType === 'image/gif' || entry.mimeType === 'image/apng'
  return buildApiUrl(`/api/images/${entry.compositeHash}/${animated ? 'file' : 'thumbnail'}`)
}

function EmoticonTile({ entry, duplicate, saving, onSave }: {
  entry: EmoticonEntry
  /** Keywords another image of the group also uses. */
  duplicate: string[]
  saving: boolean
  onSave: (keywords: string[] | null) => void
}) {
  const { t } = useI18n()
  const stored = entry.explicit ? entry.keywords.join(', ') : ''
  const [value, setValue] = useState(stored)
  // Back to what was saved whenever it changes or a save ends (a refused, clashing keyword must not linger).
  useEffect(() => {
    if (!saving) setValue(stored)
  }, [saving, stored])

  const commit = () => {
    const keywords = parseKeywords(value)
    const next = keywords.length > 0 ? keywords : null
    const current = entry.explicit ? entry.keywords : null
    if (JSON.stringify(next) !== JSON.stringify(current)) onSave(next)
  }

  const input = (
    <Input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
        if (event.key === 'Escape') {
          setValue(stored)
          event.currentTarget.blur()
        }
      }}
      disabled={saving}
      // The file-name keyword shows as the placeholder: it is what applies until something is typed.
      placeholder={entry.explicit ? '' : entry.keywords.join(', ')}
      aria-label={t({ ko: '키워드', en: 'Keywords' })}
      aria-invalid={duplicate.length > 0}
      className={cn('h-8 px-2 text-xs', duplicate.length > 0 && 'border-destructive')}
    />
  )

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-surface-low">
        <img src={emoticonSrc(entry)} alt={entry.keywords[0] ?? entry.fileName ?? ''} loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" />
      </div>
      {duplicate.length > 0
        ? <Tip content={t({ ko: '다른 이미지와 겹쳐: {words}', en: 'Also used by another image: {words}' }, { words: duplicate.join(', ') })}>{input}</Tip>
        : input}
    </div>
  )
}

/**
 * An emoticon group's keyword sheet: every image with the words that call it up in chat (`&*keyword*&`). Typing sets
 * keywords (comma-separated); an empty field falls back to the file name. Dropping files uploads them into the group.
 */
export function GroupEmoticonSection({ group }: { group: GroupRecord }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [savingHash, setSavingHash] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const queryKey = groupEmoticonsQueryKey(group.id)
  const query = useQuery({ queryKey, queryFn: () => getGroupEmoticons(group.id) })
  const entries = query.data?.entries ?? []
  const budget = query.data?.promptBudget ?? 150

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: (items: Array<{ compositeHash: string; keywords: string[] | null }>) => setGroupEmoticonKeywords(group.id, items),
    onSuccess: async (result) => {
      if (result.conflicts.length > 0) {
        showSnackbar({ tone: 'error', message: t({ ko: '겹치는 키워드라 저장하지 않았어: {words}', en: 'Not saved, keyword already used: {words}' }, { words: [...new Set(result.conflicts.map((conflict) => conflict.keyword))].join(', ') }) })
      }
      await refresh()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '키워드를 저장하지 못했어.', en: 'Could not save keywords.' })) }),
    onSettled: () => setSavingHash(null),
  })

  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      // The upload endpoint takes 20 files (and 1 GB) per request, so big drops go up in batches; each batch joins the
      // group right away, so a failure later on keeps what already landed.
      let added = 0
      let failed = 0
      // The library keys images by how they look, so a file that looks like one already here joins that image
      // instead of becoming a new emoticon.
      const known = new Set(entries.map((entry) => entry.compositeHash))
      let merged = 0
      setUploadProgress({ done: 0, total: files.length })
      for (const batch of uploadBatches(files)) {
        // Saved as-is (no format rewrite) so animated GIFs stay animated; keywords default to the file names.
        const outcome = await uploadMultipleImages(batch, {}, { enabled: false })
        const hashes = outcome.uploaded.flatMap((item) => (item.composite_hash ? [item.composite_hash] : []))
        const fresh = hashes.filter((hash) => !known.has(hash))
        merged += hashes.length - new Set(fresh).size
        for (const hash of fresh) known.add(hash)
        if (fresh.length > 0) await addGroupEmoticons(group.id, [...new Set(fresh)].map((compositeHash) => ({ compositeHash })))
        added += new Set(fresh).size
        failed += batch.length - hashes.length
        setUploadProgress((current) => (current ? { ...current, done: current.done + batch.length } : current))
      }
      return { added, failed, merged }
    },
    onSettled: () => setUploadProgress(null),
    onSuccess: async ({ added, failed, merged }) => {
      const parts = [t({ ko: '{count}개 추가', en: '{count} added' }, { count: added })]
      if (merged > 0) parts.push(t({ ko: '{count}개는 이미 있는 이미지와 같아서 합쳐짐', en: '{count} matched existing images' }, { count: merged }))
      if (failed > 0) parts.push(t({ ko: '{count}개 실패', en: '{count} failed' }, { count: failed }))
      showSnackbar({ tone: failed > 0 ? 'error' : undefined, message: parts.join(' · ') })
      await refresh()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '업로드하지 못했어.', en: 'Upload failed.' })) }),
  })

  const upload = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length > 0 && !uploadMutation.isPending) uploadMutation.mutate(images)
  }

  const resetToFileNames = async () => {
    const explicit = entries.filter((entry) => entry.explicit)
    if (explicit.length === 0) return
    const confirmed = await confirm({
      title: t({ ko: '파일명으로 다시 채울까?', en: 'Reset to file names?' }),
      description: t({ ko: '직접 입력한 키워드 {count}개가 지워지고 파일명이 키워드가 돼.', en: '{count} typed keyword sets are cleared; file names become the keywords.' }, { count: explicit.length }),
      tone: 'destructive',
    })
    if (confirmed) saveMutation.mutate(explicit.map((entry) => ({ compositeHash: entry.compositeHash, keywords: null })))
  }

  // Keywords two images share (case-insensitive), to mark both.
  const owners = new Map<string, number>()
  for (const entry of entries) for (const keyword of entry.keywords) owners.set(keyword.toLowerCase(), (owners.get(keyword.toLowerCase()) ?? 0) + 1)
  const keywordedCount = entries.filter((entry) => entry.keywords.length > 0).length
  const overBudget = keywordedCount > budget

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setIsDragOver(false)
    upload(Array.from(event.dataTransfer.files))
  }

  return (
    <section
      className={cn('space-y-4 rounded-md transition-colors', isDragOver && 'bg-primary/5 outline-2 outline-dashed outline-primary/50')}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      <div className="flex min-h-9 items-center gap-1">
        <Tip content={t({ ko: '키워드가 있는 이모티콘 / 지시문에 한 번에 들어가는 수', en: 'Emoticons with keywords / how many fit in the prompt at once' })}>
          <span className={cn('mr-auto text-sm tabular-nums', overBudget ? 'text-warning' : 'text-muted-foreground')}>
            {keywordedCount} / {budget}
          </span>
        </Tip>
        {uploadMutation.isPending ? (
          <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" role="status">
            <Spinner size="sm" />
            {uploadProgress ? `${uploadProgress.done} / ${uploadProgress.total}` : null}
          </span>
        ) : null}
        <IconButton variant="ghost" size="icon-sm" disabled={saveMutation.isPending || !entries.some((entry) => entry.explicit)} onClick={() => void resetToFileNames()} label={t({ ko: '파일명으로 다시 채우기', en: 'Reset to file names' })}>
          <RotateCcw />
        </IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()} label={t({ ko: '이모티콘 올리기', en: 'Upload emoticons' })}>
          <ImagePlus />
        </IconButton>
        <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(event) => { upload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      </div>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState title={t({ ko: '이모티콘을 불러오지 못했어.', en: 'Could not load emoticons.' })} error={query.error} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={Smile} title={t({ ko: '아직 이모티콘이 없어', en: 'No emoticons yet' })} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-3 gap-y-4">
          {entries.map((entry) => (
            <EmoticonTile
              key={entry.compositeHash}
              entry={entry}
              duplicate={entry.keywords.filter((keyword) => (owners.get(keyword.toLowerCase()) ?? 0) > 1)}
              saving={savingHash === entry.compositeHash}
              onSave={(keywords) => {
                setSavingHash(entry.compositeHash)
                saveMutation.mutate([{ compositeHash: entry.compositeHash, keywords }])
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
