import { useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Images, Loader2, Upload } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useI18n } from '@/i18n'
import { getImage, getImageDetailQueryKey, uploadMultipleImages } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'

/**
 * Pick library media (masonry picker) or upload new files through the normal library upload, then hand back hashes.
 * `kind` limits both the picker and the file dialog.
 */
export function LibraryMediaButtons({ kind, maxCount, onPick, initialHashes = [] }: {
  kind: 'video' | 'image'
  maxCount: number
  onPick: (hashes: string[]) => void
  initialHashes?: string[]
}) {
  const { t } = useI18n()
  const { has } = useFeaturePermissions()
  const { showSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const outcome = await uploadMultipleImages(files.slice(0, maxCount))
      const hashes = outcome.uploaded.flatMap((item) => item.composite_hash ? [item.composite_hash] : [])
      if (outcome.failed.length) showSnackbar({ tone: 'error', message: outcome.failed.map((failure) => failure.error).join(', ') })
      if (hashes.length) onPick(hashes)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '업로드하지 못했어.', en: 'Upload failed.' })) })
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <IconButton variant="ghost" size="icon-sm" label={kind === 'video' ? t({ ko: '라이브러리에서 영상 고르기', en: 'Choose videos from the library' }) : t({ ko: '라이브러리에서 시트 고르기', en: 'Choose sheets from the library' })} onClick={() => setOpen(true)}>
        <Images />
      </IconButton>
      {has('images.upload') ? (
        <IconButton variant="ghost" size="icon-sm" disabled={uploading} label={t({ ko: '업로드', en: 'Upload' })} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        </IconButton>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={maxCount > 1}
        accept={kind === 'video' ? 'video/*,.mkv,.mov,.webm,.avi,.mp4' : 'image/png,image/webp,image/gif,image/jpeg'}
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void upload(files) }}
      />
      {open ? (
        <ChatMediaPicker
          initial={initialHashes.map((hash) => ({ compositeHash: hash, name: hash.slice(0, 12), mimeType: null }))}
          maxCount={maxCount}
          imagesOnly={kind === 'image'}
          videosOnly={kind === 'video'}
          title={kind === 'video' ? t({ ko: '영상 고르기', en: 'Choose videos' }) : t({ ko: '시트 고르기', en: 'Choose sheets' })}
          applyLabel={t({ ko: '고르기', en: 'Choose' })}
          note={null}
          onClose={() => setOpen(false)}
          onPick={(items) => { setOpen(false); onPick(items.map((item) => item.compositeHash)) }}
        />
      ) : null}
    </>
  )
}

/** Saved outputs shown the library way: the masonry list, opening the viewer on click. */
export function LibraryResults({ hashes }: { hashes: string[] }) {
  const queries = useQueries({ queries: hashes.map((hash) => ({ queryKey: getImageDetailQueryKey(hash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(hash, { signal }), retry: false })) })
  const items = queries.flatMap((query) => query.data ? [query.data] : [])
  if (!items.length) return null
  return (
    <ImageList
      items={items}
      resetKey={hashes.join(',')}
      layout="masonry"
      activationMode="modal"
      scrollMode="container"
      viewportHeight="min(40vh, 360px)"
      minColumnWidth={140}
      columnGap={8}
      rowGap={8}
      showDefaultQuickActions={false}
    />
  )
}
