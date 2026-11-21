import { useId, useState } from 'react'
import { ArrowLeft, ArrowRight, Crop, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { ReferenceImageGallery } from '@/components/common/reference-image-gallery'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { EditorFooter } from '@/components/ui/editor-footer'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { ChatProfileAvatarCrop } from '@/features/settings/components/chat-profile-avatar-crop'
import { useI18n } from '@/i18n'
import type { ChatAssetUploadTarget } from '@/lib/api-codex-chat'
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
  const categoryErrorId = useId()
  const { draft, base } = editor
  // null is all images; {category:null} is the uncategorized filter.
  const [filter, setFilter] = useState<{ category: string | null } | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ previous: string | null; value: string } | null>(null)
  const [categoryError, setCategoryError] = useState(false)
  const [cropHash, setCropHash] = useState<string | null>(null)
  const category = filter?.category ?? null
  const effectiveFilter = filter?.category && !draft.referenceCategories.includes(filter.category) ? null : filter
  const edit = (change: ReferenceEdit) => editor.patch(editReferenceDraft(editor.draftRef.current, change))
  const add = (hash: string) => edit({ kind: 'add', hashes: [hash], category: category && editor.draftRef.current.referenceCategories.includes(category) ? category : null })
  const target: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null = !(editable && canUpload) ? null : base ? { settingId: base.id } : async () => {
    if (!editor.isCurrent()) throw new Error(t({ ko: '편집 중인 외형 설정이 바뀌었어.', en: 'The open setting changed.' }))
    const setting = await editor.ensureSetting()
    if (!editor.isCurrent()) throw new Error(t({ ko: '편집 중인 외형 설정이 바뀌었어.', en: 'The open setting changed.' }))
    return { settingId: setting.id }
  }

  const unclassified = t({ ko: '미분류', en: 'Uncategorized' })
  const categoryOf = (hash: string) => draft.references.find((image) => image.hash === hash)?.category ?? null
  const shown = draft.references.filter((image) => !effectiveFilter || image.category === effectiveFilter.category).map((image) => image.hash)
  const openCategoryDialog = (previous: string | null) => { setCategoryError(false); setCategoryDialog({ previous, value: previous ?? '' }) }

  return <>
    <ReferenceImageGallery
      items={draft.references.map((image) => image.hash)}
      shown={shown}
      editable={editable}
      busy={busy}
      onBusyChange={onBusyChange}
      uploadTarget={target}
      libraryGroupId={base?.candidateGroupId ?? null}
      isCurrent={editor.isCurrent}
      onAdd={add}
      onReorder={(hash, before) => edit({ kind: 'reorder', hash, before })}
      ariaLabel={t({ ko: '참고 이미지 갤러리', en: 'Reference gallery' })}
      // Under its own "참고 이미지" tab the tab names the gallery, so the key joins the category row instead of a heading.
      heading={imageTabShown ? undefined : t({ ko: '참고 이미지', en: 'Reference images' })}
      pasteAnywhere={imageTabShown}
      emptyLabel={t({ ko: '참고 이미지가 없어.', en: 'No reference images.' })}
      imageLabel={(hash) => t({ ko: '참고 이미지 · {category}', en: 'Reference image · {category}' }, { category: categoryOf(hash) ?? unclassified })}
      imageTitle={(hash) => <Badge variant="overlay" size="xs" casing="sentence">{categoryOf(hash) ?? unclassified}</Badge>}
      imageBadges={(hash) => hash === draft.referenceHash || hash === draft.avatarHash ? <>
        {hash === draft.referenceHash ? <Badge variant="overlay" size="xs"><Star />{t({ ko: '기준', en: 'Main' })}</Badge> : null}
        {hash === draft.avatarHash ? <Badge variant="overlay" size="xs">{t({ ko: '아바타', en: 'Avatar' })}</Badge> : null}
      </> : null}
      imageMenu={(hash, disabled) => [
        { key: 'main', label: t({ ko: '기준으로', en: 'Use as main' }), icon: Star, disabled: disabled || hash === draft.referenceHash, onSelect: () => edit({ kind: 'reference', hash }) },
        { key: 'avatar', label: t({ ko: '아바타로', en: 'Use as avatar' }), icon: Crop, disabled, onSelect: () => setCropHash(hash) },
        '-',
        ...[null, ...draft.referenceCategories].map((name) => ({ key: `category:${name ?? ''}`, label: t({ ko: '분류: {name}', en: 'Category: {name}' }, { name: name ?? unclassified }), checked: categoryOf(hash) === name, disabled, onSelect: () => edit({ kind: 'category', hash, category: name }) })),
        '-',
        { key: 'earlier', label: t({ ko: '앞으로 옮기기', en: 'Move earlier' }), icon: ArrowLeft, disabled: disabled || hash === draft.references[0]?.hash, onSelect: () => {
          const index = draft.references.findIndex((entry) => entry.hash === hash)
          if (index > 0) edit({ kind: 'reorder', hash, before: draft.references[index - 1].hash })
        } },
        { key: 'later', label: t({ ko: '뒤로 옮기기', en: 'Move later' }), icon: ArrowRight, disabled: disabled || hash === draft.references.at(-1)?.hash, onSelect: () => {
          const index = draft.references.findIndex((entry) => entry.hash === hash)
          if (index >= 0 && index + 1 < draft.references.length) edit({ kind: 'reorder', hash: draft.references[index + 1].hash, before: hash })
        } },
        '-',
        { key: 'remove', label: t({ ko: '빼기', en: 'Remove' }), icon: X, destructive: true, disabled, onSelect: () => edit({ kind: 'remove', hash }) },
      ]}
      toolbar={(addButton, disabled) => <div className="flex flex-wrap items-center gap-1.5">
        <ToggleChip size="sm" pressed={!effectiveFilter} onClick={() => setFilter(null)}>{t({ ko: '전체', en: 'All' })} {draft.references.length}</ToggleChip>
        {draft.referenceCategories.map((name) => <ToggleChip key={name} size="sm" pressed={effectiveFilter?.category === name} onClick={() => setFilter({ category: name })}>{name} {draft.references.filter((image) => image.category === name).length}</ToggleChip>)}
        <ToggleChip size="sm" pressed={Boolean(effectiveFilter && effectiveFilter.category === null)} onClick={() => setFilter({ category: null })}>{unclassified} {draft.references.filter((image) => image.category === null).length}</ToggleChip>
        {editable ? <>
          <IconButton size="icon-xs" variant="ghost" label={t({ ko: '분류 추가', en: 'Add category' })} disabled={disabled} onClick={() => openCategoryDialog(null)}><Plus /></IconButton>
          {effectiveFilter?.category ? <ActionMenuButton label={t({ ko: '분류 작업', en: 'Category actions' })} entries={[
            { key: 'rename', label: t({ ko: '분류 이름 바꾸기', en: 'Rename category' }), icon: Pencil, disabled, onSelect: () => openCategoryDialog(effectiveFilter.category) },
            { key: 'delete', label: t({ ko: '분류 지우기 · 이미지는 미분류로', en: 'Delete category · keep images uncategorized' }), icon: Trash2, disabled, onSelect: () => { edit({ kind: 'remove-category', name: effectiveFilter.category! }); setFilter({ category: null }) } },
          ]} /> : null}
        </> : null}
        {addButton ? <div className="ml-auto">{addButton}</div> : null}
      </div>}
    />
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
  </>
}
