import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Crop, Pencil, Plus, Star, Trash2, Upload, X } from 'lucide-react'
import { OverlayCard } from '@/components/common/overlay-card'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { EditorFooter } from '@/components/ui/editor-footer'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileAssetInput, useChatProfileAssetImport } from '@/features/settings/components/chat-profile-asset-input'
import { useSafeAssetImages } from '@/features/settings/components/chat-profile-asset-slots'
import { ChatProfileAvatarCrop } from '@/features/settings/components/chat-profile-avatar-crop'
import { useI18n } from '@/i18n'
import { uploadChatProfileAsset, type ChatAssetUploadTarget } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { characterImageUrl } from '../character-library-shared'
import { editReferenceDraft, type ReferenceEdit } from '../character-reference-draft'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'

/** Ordered reference images and categories belong to the draft, not to a separate gallery save. */
export function CharacterReferenceGallery({ editor, editable, canUpload, imageTabShown = false, busy, onBusyChange }: {
  editor: CharacterSettingEditorState
  editable: boolean
  canUpload: boolean
  imageTabShown?: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const canEdit = editable && canViewImages
  const uploadsAllowed = canEdit && canUpload
  const root = useRef<HTMLElement>(null)
  const active = useRef(true)
  const categoryErrorId = useId()
  const { draft, base } = editor
  // null is all images; {category:null} is the uncategorized filter.
  const [filter, setFilter] = useState<{ category: string | null } | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ previous: string | null; value: string } | null>(null)
  const [categoryError, setCategoryError] = useState(false)
  const [cropHash, setCropHash] = useState<string | null>(null)
  const dragged = useRef<string | null>(null)
  const images = useSafeAssetImages(draft.references.map((image) => image.hash), true)
  const category = filter?.category ?? null
  const effectiveFilter = filter?.category && !draft.referenceCategories.includes(filter.category) ? null : filter
  const edit = (change: ReferenceEdit) => editor.patch(editReferenceDraft(editor.draftRef.current, change))
  const add = (hash: string) => {
    if (active.current && editor.isCurrent()) edit({ kind: 'add', hashes: [hash], category: category && editor.draftRef.current.referenceCategories.includes(category) ? category : null })
  }
  const target: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null = !uploadsAllowed ? null : base ? { settingId: base.id } : async () => {
    if (!editor.isCurrent()) throw new Error(t({ ko: '편집 중인 외형 설정이 바뀌었어.', en: 'The open setting changed.' }))
    const setting = await editor.ensureSetting()
    if (!editor.isCurrent()) throw new Error(t({ ko: '편집 중인 외형 설정이 바뀌었어.', en: 'The open setting changed.' }))
    return { settingId: setting.id }
  }
  const importing = useChatProfileAssetImport(add, onBusyChange)
  const uploadFiles = async (files: File[]) => {
    const selected = files.filter((file) => file.type.startsWith('image/'))
    if (!target || busy || importing.isPending || !selected.length) return
    onBusyChange(true)
    try {
      const owner = typeof target === 'function' ? await target() : target
      for (const file of selected) {
        if (!active.current || !editor.isCurrent()) break
        try { await importing.mutateAsync(() => uploadChatProfileAsset(file, owner)) }
        catch { break } // The shared importer already reports the failed upload.
      }
    } catch (error) {
      if (active.current && editor.isCurrent()) showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' })), tone: 'error' })
    } finally { onBusyChange(false) }
  }
  const paste = useEffectEvent((event: ClipboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    // A paste into a field, the chat dock or a dialog opened over the gallery's own (the setting dialog) is not for it.
    const dialog = target?.closest('[role="dialog"]')
    if (!uploadsAllowed || busy || importing.isPending || (!imageTabShown && !root.current?.contains(document.activeElement)) || target?.closest('input,textarea,[contenteditable="true"],[data-chat-dock]') || (dialog && !dialog.contains(root.current))) return
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

  const unclassified = t({ ko: '미분류', en: 'Uncategorized' })
  const shown = draft.references.filter((image) => !effectiveFilter || image.category === effectiveFilter.category)
  const disabled = busy || importing.isPending
  const openCategoryDialog = (previous: string | null) => { setCategoryError(false); setCategoryDialog({ previous, value: previous ?? '' }) }
  const addButton = canEdit ? <ChatProfileAssetInput target={target} libraryGroupId={base?.candidateGroupId ?? null} label={t({ ko: '추가', en: 'Add' })} size="compact" busy={disabled} onChange={add} onBusyChange={onBusyChange} /> : null

  return <section ref={root} tabIndex={0} className="space-y-3" aria-label={t({ ko: '참고 이미지 갤러리', en: 'Reference gallery' })}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDrop={(event) => {
      if (event.dataTransfer.types.includes('Files') || event.dataTransfer.files.length) event.preventDefault()
      if (!uploadsAllowed || disabled || !event.dataTransfer.files.length) return
      void uploadFiles([...event.dataTransfer.files])
    }}>
    {/* Under its own "참고 이미지" tab the tab names the gallery, so the key joins the category row instead of a heading. */}
    {!imageTabShown ? <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold">{t({ ko: '참고 이미지', en: 'Reference images' })}</h3>
      <span className="text-xs text-muted-foreground">{t({ ko: '{count}장', en: '{count} images' }, { count: draft.references.length })}</span>
      {addButton ? <div className="ml-auto">{addButton}</div> : null}
    </div> : null}
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleChip size="sm" pressed={!effectiveFilter} onClick={() => setFilter(null)}>{t({ ko: '전체', en: 'All' })} {draft.references.length}</ToggleChip>
      {draft.referenceCategories.map((name) => <ToggleChip key={name} size="sm" pressed={effectiveFilter?.category === name} onClick={() => setFilter({ category: name })}>{name} {draft.references.filter((image) => image.category === name).length}</ToggleChip>)}
      <ToggleChip size="sm" pressed={Boolean(effectiveFilter && effectiveFilter.category === null)} onClick={() => setFilter({ category: null })}>{unclassified} {draft.references.filter((image) => image.category === null).length}</ToggleChip>
      {canEdit ? <>
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '분류 추가', en: 'Add category' })} disabled={disabled} onClick={() => openCategoryDialog(null)}><Plus /></IconButton>
        {effectiveFilter?.category ? <ActionMenuButton label={t({ ko: '분류 작업', en: 'Category actions' })} entries={[
          { key: 'rename', label: t({ ko: '분류 이름 바꾸기', en: 'Rename category' }), icon: Pencil, disabled, onSelect: () => openCategoryDialog(effectiveFilter.category) },
          { key: 'delete', label: t({ ko: '분류 지우기 · 이미지는 미분류로', en: 'Delete category · keep images uncategorized' }), icon: Trash2, disabled, onSelect: () => { edit({ kind: 'remove-category', name: effectiveFilter.category! }); setFilter({ category: null }) } },
        ]} /> : null}
      </> : null}
      {imageTabShown && addButton ? <div className="ml-auto">{addButton}</div> : null}
    </div>
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 8rem), 1fr))' }}>
      {shown.map((image) => <div key={image.hash} className="min-w-0"
        onDragOver={(event) => { if (canEdit && !disabled && dragged.current) event.preventDefault() }}
        onDrop={(event) => {
          if (!canEdit || disabled || !dragged.current) return
          event.preventDefault(); event.stopPropagation()
          edit({ kind: 'reorder', hash: dragged.current, before: image.hash })
          dragged.current = null
        }}>
        <OverlayCard label={t({ ko: '참고 이미지 · {category}', en: 'Reference image · {category}' }, { category: image.category ?? unclassified })}
          title={<Badge variant="overlay" size="xs" casing="sentence">{image.category ?? unclassified}</Badge>}
          media={images.render(image.hash)} onOpen={() => images.open(image.hash)}
          draggable={canEdit && !disabled} onDragStart={(event) => { dragged.current = image.hash; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', image.hash) }} onDragEnd={() => { dragged.current = null }}
          topStart={image.hash === draft.referenceHash || image.hash === draft.avatarHash ? <>
            {image.hash === draft.referenceHash ? <Badge variant="overlay" size="xs"><Star />{t({ ko: '기준', en: 'Main' })}</Badge> : null}
            {image.hash === draft.avatarHash ? <Badge variant="overlay" size="xs">{t({ ko: '아바타', en: 'Avatar' })}</Badge> : null}
          </> : undefined}
          menu={canEdit ? [
            { key: 'main', label: t({ ko: '기준으로', en: 'Use as main' }), icon: Star, disabled: disabled || image.hash === draft.referenceHash, onSelect: () => edit({ kind: 'reference', hash: image.hash }) },
            { key: 'avatar', label: t({ ko: '아바타로', en: 'Use as avatar' }), icon: Crop, disabled, onSelect: () => setCropHash(image.hash) },
            '-',
            ...[null, ...draft.referenceCategories].map((name) => ({ key: `category:${name ?? ''}`, label: t({ ko: '분류: {name}', en: 'Category: {name}' }, { name: name ?? unclassified }), checked: image.category === name, disabled, onSelect: () => edit({ kind: 'category', hash: image.hash, category: name }) })),
            '-',
            { key: 'earlier', label: t({ ko: '앞으로 옮기기', en: 'Move earlier' }), icon: ArrowLeft, disabled: disabled || image.hash === draft.references[0]?.hash, onSelect: () => {
              const index = draft.references.findIndex((entry) => entry.hash === image.hash)
              if (index > 0) edit({ kind: 'reorder', hash: image.hash, before: draft.references[index - 1].hash })
            } },
            { key: 'later', label: t({ ko: '뒤로 옮기기', en: 'Move later' }), icon: ArrowRight, disabled: disabled || image.hash === draft.references.at(-1)?.hash, onSelect: () => {
              const index = draft.references.findIndex((entry) => entry.hash === image.hash)
              if (index >= 0 && index + 1 < draft.references.length) edit({ kind: 'reorder', hash: draft.references[index + 1].hash, before: image.hash })
            } },
            '-',
            { key: 'remove', label: t({ ko: '빼기', en: 'Remove' }), icon: X, destructive: true, disabled, onSelect: () => edit({ kind: 'remove', hash: image.hash }) },
          ] : undefined} />
      </div>)}
      {uploadsAllowed ? <div className={cn('flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line p-2 text-center text-xs text-muted-foreground', !shown.length && 'col-span-full aspect-auto py-10')}>
        <Upload className="size-5" />
        <span>{t({ ko: '끌어다 놓기', en: 'Drop images here' })}<br />{t({ ko: 'Ctrl+V 붙여넣기', en: 'Ctrl+V to paste' })}</span>
      </div> : null}
    </div>
    {!shown.length && !canEdit ? <p className="text-xs text-muted-foreground">{t({ ko: '참고 이미지가 없어.', en: 'No reference images.' })}</p> : null}
    {categoryDialog ? <Modal open size="sm" title={categoryDialog.previous === null ? t({ ko: '분류 추가', en: 'Add category' }) : t({ ko: '분류 이름 바꾸기', en: 'Rename category' })}
      onClose={() => { setCategoryError(false); setCategoryDialog(null) }}>
      <form onSubmit={(event) => {
        event.preventDefault()
        try {
          edit(categoryDialog.previous === null ? { kind: 'add-category', name: categoryDialog.value } : { kind: 'rename-category', name: categoryDialog.previous, next: categoryDialog.value })
          setFilter({ category: categoryDialog.value.trim() }); setCategoryError(false); setCategoryDialog(null)
        } catch {
          setCategoryError(true)
        }
      }}>
        <ModalBody>
          <Input autoFocus aria-label={t({ ko: '분류 이름', en: 'Category name' })} aria-invalid={categoryError || undefined} aria-describedby={categoryError ? categoryErrorId : undefined} value={categoryDialog.value} onChange={(event) => { setCategoryError(false); setCategoryDialog({ ...categoryDialog, value: event.target.value }) }} />
          {categoryError ? <p id={categoryErrorId} role="alert" className="text-xs text-destructive">{t({ ko: '분류 이름을 확인해줘. 비어 있거나 같은 이름은 쓸 수 없어.', en: 'Check the category name. It cannot be empty or duplicate another name.' })}</p> : null}
        </ModalBody>
        <EditorFooter saveSubmit saveLabel={t({ ko: '적용', en: 'Apply' })} />
      </form>
    </Modal> : null}
    {cropHash ? <ChatProfileAvatarCrop src={characterImageUrl(cropHash)} initial={draft.avatarHash === cropHash ? draft.avatarCrop : null}
      onApply={(avatarCrop) => { editor.patch({ avatarHash: cropHash, avatarCrop }); setCropHash(null) }} onClose={() => setCropHash(null)} /> : null}
    {images.lightbox}
  </section>
}
