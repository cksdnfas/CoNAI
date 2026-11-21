import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { OverlayCard } from '@/components/common/overlay-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { ChatProfileAssetInput, useChatProfileAssetImport } from '@/features/settings/components/chat-profile-asset-input'
import { useSafeAssetImages } from '@/features/settings/components/chat-profile-asset-slots'
import { useI18n } from '@/i18n'
import { uploadChatProfileAsset, type ChatAssetUploadTarget } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'

/** Where an image that is not a library image shows from (an owner's own copy, a staged upload). */
export type GalleryImageSource = { thumbnailUrl: string; fullUrl: string; name: string; mimeType?: string | null; width?: number | null; height?: number | null }
/** What a gallery key shows: its own URLs, or a library image (loaded with the safety settings like a plain hash). */
export type GalleryImage = GalleryImageSource | { libraryHash: string }
/**
 * An owner's own add key and upload path in place of the library import: `button` gets whether adding is paused;
 * `upload` takes the dropped or pasted image files (null: no uploads). The owner reports busy and adds what lands.
 */
export type GalleryAdder = { button: (disabled: boolean) => ReactNode; upload: ((files: File[]) => Promise<void>) | null }

/** The images of a `source`: thumbnails and the full-size viewer from the URLs it gives. */
function useSourceImages(keys: string[], source: (key: string) => GalleryImageSource | null) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const records: ImageRecord[] = keys.flatMap((key) => {
    const image = source(key)
    return image ? [{ id: key, composite_hash: null, thumbnail_url: image.thumbnailUrl, image_url: image.fullUrl, mime_type: image.mimeType ?? null, width: image.width ?? null, height: image.height ?? null }] : []
  })
  return {
    render: (key: string, className = 'size-full object-cover') => {
      const image = source(key)
      return image ? <ChatProfileImage src={image.thumbnailUrl} className={className} /> : null
    },
    open: (key: string) => { const index = records.findIndex((record) => record.id === key); if (index >= 0) setLightbox(index) },
    lightbox: <MediaLightbox items={records} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />,
  }
}

/**
 * An owner's ordered images as a card grid (appearance setting references, art styles): the add key (library pick, and
 * with an `uploadTarget` file upload, URL and file store), drop and Ctrl+V uploads (with a target), drag to reorder, a ⋯
 * menu per image and the full-size viewer. The owner keeps the list: `onAdd` / `onReorder` edit its draft. `items`
 * are library hashes unless `source` resolves each key (then `adder` brings the owner's own add key and uploads).
 * `heading` adds the title row with the count and the add key; without it `toolbar` places the add key. Without
 * `images.view` it only says so.
 */
export function ReferenceImageGallery({ items, shown = items, source, adder, editable, busy, onBusyChange, uploadTarget, libraryGroupId = null, isCurrent, onAdd, onReorder, imageLabel, imageTitle, imageBadges, imageMenu, heading, count, toolbar, pasteAnywhere = false, full = false, emptyLabel, ariaLabel }: {
  /** Every image's key, in order (loaded together; the viewer steps through them). */
  items: string[]
  /** The ones shown (a filter); all by default. */
  shown?: string[]
  /** Resolves each key when they are not library hashes: to its own URLs or to a library image. */
  source?: (key: string) => GalleryImage | null
  /** The owner's add key and upload path, in place of the library import (`uploadTarget` is then unused). */
  adder?: GalleryAdder
  /** The owner may change its images (images.view is checked here). */
  editable: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  /** Where uploads land; null offers only the library pick. A function resolves it when an upload starts. */
  uploadTarget: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null
  /** The group the library pick opens at. */
  libraryGroupId?: number | null
  /** The owner is still the one open (late uploads are dropped otherwise). */
  isCurrent: () => boolean
  /** A library import landed (not called with an `adder`, which adds by itself). */
  onAdd?: (hash: string) => void
  onReorder: (hash: string, before: string) => void
  imageLabel: (hash: string) => string
  imageTitle?: (hash: string) => ReactNode
  /** Over the image's top-left corner. */
  imageBadges?: (hash: string) => ReactNode
  imageMenu?: (hash: string, disabled: boolean) => ActionMenuEntry[]
  heading?: string
  /** Beside the heading (default "N장"). */
  count?: string
  /** A row under the heading; gets the add key (null when not editable) and whether editing is paused. */
  toolbar?: (addButton: ReactNode, disabled: boolean) => ReactNode
  /** Ctrl+V uploads even when the focus is elsewhere in the dialog (the gallery fills its tab). */
  pasteAnywhere?: boolean
  /** At its limit: the add key is disabled. */
  full?: boolean
  /** Shown to people who cannot edit when there is nothing to show. */
  emptyLabel: string
  ariaLabel: string
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const canEdit = editable && canViewImages
  const uploadsAllowed = canEdit && (adder ? adder.upload !== null : uploadTarget !== null)
  const root = useRef<HTMLElement>(null)
  const active = useRef(true)
  const dragged = useRef<string | null>(null)
  const libraryHashOf = (key: string) => {
    if (!source) return key
    const image = source(key)
    return image && 'libraryHash' in image ? image.libraryHash : null
  }
  const ownSourceOf = (key: string) => {
    const image = source?.(key)
    return image && !('libraryHash' in image) ? image : null
  }
  const libraryImages = useSafeAssetImages(items.flatMap((key) => { const hash = libraryHashOf(key); return hash ? [hash] : [] }), true)
  const ownImages = useSourceImages(source ? items : [], ownSourceOf)
  const images = {
    render: (key: string) => { const hash = libraryHashOf(key); return hash ? libraryImages.render(hash) : ownImages.render(key) },
    open: (key: string) => { const hash = libraryHashOf(key); if (hash) libraryImages.open(hash); else ownImages.open(key) },
    lightbox: <>{libraryImages.lightbox}{ownImages.lightbox}</>,
  }
  const add = (hash: string) => { if (active.current && isCurrent()) onAdd?.(hash) }
  const importing = useChatProfileAssetImport(add, onBusyChange)
  const uploadFiles = async (files: File[]) => {
    const selected = files.filter((file) => file.type.startsWith('image/'))
    if (busy || importing.isPending || full || !selected.length) return
    if (adder) {
      if (adder.upload) await adder.upload(selected)
      return
    }
    if (!uploadTarget) return
    onBusyChange(true)
    try {
      const owner = typeof uploadTarget === 'function' ? await uploadTarget() : uploadTarget
      for (const file of selected) {
        if (!active.current || !isCurrent()) break
        try { await importing.mutateAsync(() => uploadChatProfileAsset(file, owner)) }
        catch { break } // The shared importer already reports the failed upload.
      }
    } catch (error) {
      if (active.current && isCurrent()) showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' })), tone: 'error' })
    } finally { onBusyChange(false) }
  }
  const paste = useEffectEvent((event: ClipboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    // A paste into a field, the chat dock or a dialog opened over the gallery's own (the owner's dialog) is not for it.
    const dialog = target?.closest('[role="dialog"]')
    if (!uploadsAllowed || busy || importing.isPending || (!pasteAnywhere && !root.current?.contains(document.activeElement)) || target?.closest('input,textarea,[contenteditable="true"],[data-chat-dock]') || (dialog && !dialog.contains(root.current))) return
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
    if (files.length) { event.preventDefault(); void uploadFiles(files) }
  })
  useEffect(() => {
    active.current = true
    const listener = (event: ClipboardEvent) => paste(event)
    document.addEventListener('paste', listener)
    return () => { active.current = false; document.removeEventListener('paste', listener) }
  }, [])
  if (!canViewImages) return <p className="text-sm text-muted-foreground">{t({ ko: '이미지를 볼 권한이 없어.', en: 'You do not have permission to view images.' })}</p>

  const disabled = busy || importing.isPending
  const addButton = !canEdit ? null : adder ? adder.button(disabled || full)
    : <ChatProfileAssetInput target={uploadTarget} libraryGroupId={libraryGroupId} label={t({ ko: '추가', en: 'Add' })} size="compact" busy={disabled || full} onChange={add} onBusyChange={onBusyChange} />

  return <section ref={root} tabIndex={0} className="space-y-3" aria-label={ariaLabel}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDrop={(event) => {
      if (event.dataTransfer.types.includes('Files') || event.dataTransfer.files.length) event.preventDefault()
      if (!uploadsAllowed || disabled || !event.dataTransfer.files.length) return
      void uploadFiles([...event.dataTransfer.files])
    }}>
    {heading ? <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <span className="text-xs text-muted-foreground">{count ?? t({ ko: '{count}장', en: '{count} images' }, { count: items.length })}</span>
      {addButton ? <div className="ml-auto">{addButton}</div> : null}
    </div> : null}
    {toolbar?.(heading ? null : addButton, disabled)}
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 8rem), 1fr))' }}>
      {shown.map((hash) => <div key={hash} className="min-w-0"
        onDragOver={(event) => { if (canEdit && !disabled && dragged.current) event.preventDefault() }}
        onDrop={(event) => {
          if (!canEdit || disabled || !dragged.current) return
          event.preventDefault(); event.stopPropagation()
          onReorder(dragged.current, hash)
          dragged.current = null
        }}>
        <OverlayCard label={imageLabel(hash)}
          title={imageTitle?.(hash) ?? null}
          media={images.render(hash)} onOpen={() => images.open(hash)}
          draggable={canEdit && !disabled} onDragStart={(event) => { dragged.current = hash; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', hash) }} onDragEnd={() => { dragged.current = null }}
          topStart={imageBadges?.(hash) ?? undefined}
          menu={canEdit ? imageMenu?.(hash, disabled) : undefined} />
      </div>)}
      {uploadsAllowed ? <div className={cn('flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line p-2 text-center text-xs text-muted-foreground', !shown.length && 'col-span-full aspect-auto py-10')}>
        <Upload className="size-5" />
        <span>{t({ ko: '끌어다 놓기', en: 'Drop images here' })}<br />{t({ ko: 'Ctrl+V 붙여넣기', en: 'Ctrl+V to paste' })}</span>
      </div> : null}
    </div>
    {!shown.length && !canEdit ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null}
    {images.lightbox}
  </section>
}
