import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ART_STYLE_LIMITS } from '@conai/shared'
import { ArrowUpToLine, Copy, CopyPlus, Download, Star, Trash2, X } from 'lucide-react'
import { addTerm, ChipListInput } from '@/components/common/chip-list-input'
import { EditorTitleInput } from '@/components/common/editor-page'
import { FieldTabs, FramedField } from '@/components/common/field-tabs'
import { LibraryItemDialog } from '@/components/common/library-item-dialog'
import { ReferenceImageGallery, type GalleryImage } from '@/components/common/reference-image-gallery'
import { SaveConflictAlert, SaveConflictOverwriteButton } from '@/components/common/save-conflict-alert'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Field, FieldGroup } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { artStyleBadgesQueryKey, artStyleImageUrl, artStyleThumbnailUrl, listArtStyleBadges } from '@/lib/api-art-styles'
import { storedFileThumbnailUrl, storedFileViewUrl } from '@/lib/api-files'
import { buildWorkflowInputAssetUrl } from '@/lib/api-workflow-input-assets'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { artStyleImageKey, isStagedArtStyleImage, type ArtStyleDraftImage } from '../use-art-style-editor'
import type { ArtStyleLibrary } from '../use-art-style-library'
import { ArtStyleImageAdd } from './art-style-image-add'

/**
 * One art style over the list (`style=<id>`): the title edited in the header, favorite and ⋯ beside it, stepping
 * through the listed styles, saving with Ctrl+S. Left the reference images (first = cover), right the description,
 * badges, search keywords and the prompt (긍정 / 부정 in one frame). Without characters.edit it only shows; without
 * images.view the image column is left out.
 */
export function ArtStyleDialog({ library }: { library: ArtStyleLibrary }) {
  const { t } = useI18n()
  const { editor, canEdit, loaded, total, loadMore, openStyle, closeStyle, toggleFavorite, duplicate, exportStyles, copyPositive } = library
  const { base, draft, busy } = editor
  return (
    <LibraryItemDialog
      title={editor.ready
        ? <EditorTitleInput as="span" value={draft.title} label={t({ ko: '스타일 제목', en: 'Style title' })} placeholder={t({ ko: '제목', en: 'Title' })} maxLength={ART_STYLE_LIMITS.title} readOnly={!canEdit} invalid={Boolean(editor.titleError) || (editor.ready && !draft.title.trim())} onChange={(title) => editor.patch({ title })} />
        : t({ ko: '그림 스타일', en: 'Art style' })}
      description={editor.titleError ? <span role="alert" className="text-destructive">{editor.titleError}</span> : undefined}
      actions={editor.ready && base ? <>
        {canEdit ? <IconButton variant="ghost" size="icon-sm" active={base.favorite} disabled={busy || library.bulkPending} label={base.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })} onClick={() => toggleFavorite(base)}><Star className={base.favorite ? 'fill-current' : undefined} /></IconButton> : null}
        <ActionMenuButton label={t({ ko: '스타일 작업', en: 'Style actions' })} entries={[
          { key: 'copy', label: t({ ko: '긍정 프롬프트 복사', en: 'Copy positive prompt' }), icon: Copy, onSelect: () => void copyPositive(base) },
          canEdit ? { key: 'duplicate', label: t({ ko: '복제', en: 'Duplicate' }), icon: CopyPlus, disabled: busy, onSelect: () => void duplicate(base) } : null,
          { key: 'export', label: t({ ko: '내보내기', en: 'Export' }), icon: Download, onSelect: () => void exportStyles({ ids: [base.id] }, base.title) },
          canEdit ? '-' : null,
          // Failures are already reported by the editor.
          canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy || editor.deleting, onSelect: () => void editor.remove(true).catch(() => undefined) } : null,
        ]} />
      </> : undefined}
      ready={editor.ready}
      canEdit={canEdit}
      dirty={editor.dirty}
      canSave={editor.canSave}
      saving={editor.saving}
      busy={busy}
      isBusy={editor.isBusy}
      isCurrent={editor.isCurrent}
      session={editor.session}
      onSave={() => void editor.save().catch(() => undefined)}
      onRevert={editor.revert}
      items={loaded ?? []}
      total={total ?? loaded?.length ?? 0}
      openId={editor.styleId}
      onLoadMore={loadMore}
      onOpen={openStyle}
      onClose={closeStyle}
      previousLabel={t({ ko: '이전 스타일', en: 'Previous style' })}
      nextLabel={t({ ko: '다음 스타일', en: 'Next style' })}
      loadMoreError={t({ ko: '다음 스타일을 불러오지 못했어.', en: 'Could not load more styles.' })}
    >
      {/* Per style: the prompt tab, chip fields and gallery state start fresh while the dialog and its footer stay. */}
      <ArtStyleBody key={editor.session} library={library} />
    </LibraryItemDialog>
  )
}

function ArtStyleBody({ library }: { library: ArtStyleLibrary }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { editor, canEdit, canViewImages, canUpload, canPickFiles } = library
  const { base, draft, busy } = editor
  const [promptTab, setPromptTab] = useState<'positive' | 'negative'>('positive')
  // Suggestions come from every badge in use, not only the listed scope's.
  const allBadges = useQuery({ queryKey: artStyleBadgesQueryKey({ query: '', favorite: false }), queryFn: ({ signal }) => listArtStyleBadges({ query: '', favorite: false }, signal), enabled: canEdit })
  const editable = canEdit && editor.ready
  // The gallery works on keys; the draft keeps the tagged items a save sends.
  const images = draft.images.map(artStyleImageKey)
  const byKey = new Map(draft.images.map((image) => [artStyleImageKey(image), image]))
  const held = new Map((base?.images ?? []).map((image) => [image.id, image]))
  const imageSource = (key: string): GalleryImage | null => {
    const image = byKey.get(key)
    if (!image || !base) return null
    if (isStagedArtStyleImage(image)) { const url = buildWorkflowInputAssetUrl(image); return { thumbnailUrl: url, fullUrl: url, name: image.fileName, mimeType: image.mimeType } }
    if ('composite_hash' in image) return { libraryHash: image.composite_hash }
    if ('file_id' in image) return { thumbnailUrl: storedFileThumbnailUrl(image.file_id), fullUrl: storedFileViewUrl(image.file_id), name: '' }
    const stored = held.get(image.id)
    return { thumbnailUrl: artStyleThumbnailUrl(base.id, image.id), fullUrl: artStyleImageUrl(base.id, image.id), name: stored?.name ?? '', mimeType: stored?.mimeType, width: stored?.width, height: stored?.height }
  }
  const setImages = (update: (current: ArtStyleDraftImage[]) => ArtStyleDraftImage[]) => editor.patch({ images: update(editor.draftRef.current.images) })
  const appendImages = (added: ArtStyleDraftImage[]) => setImages((current) => {
    const keys = new Set(current.map(artStyleImageKey))
    const next = [...current]
    for (const image of added) {
      const key = artStyleImageKey(image)
      if (keys.has(key) || next.length >= ART_STYLE_LIMITS.images) continue
      keys.add(key)
      next.push(image)
    }
    return next
  })
  const moveFirst = (key: string) => setImages((current) => {
    const image = current.find((item) => artStyleImageKey(item) === key)
    return image ? [image, ...current.filter((item) => item !== image)] : current
  })
  const prompt = draft[promptTab]
  const copyPrompt = async () => {
    try {
      await copyTextToClipboard(prompt)
      showSnackbar({ message: promptTab === 'positive' ? t({ ko: '긍정 프롬프트를 복사했어.', en: 'Copied the positive prompt.' }) : t({ ko: '부정 프롬프트를 복사했어.', en: 'Copied the negative prompt.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }

  if (editor.loading) return <ModalBody><LoadingState variant="inline" /></ModalBody>
  if (editor.error) return <ModalBody><ErrorState title={t({ ko: '스타일을 불러오지 못했어', en: 'Could not load the style' })} error={editor.error} onRetry={editor.retry} /></ModalBody>
  if (!editor.ready || !base) return <ModalBody />
  return (
    <ModalBody>
      {editor.conflict ? (
        <SaveConflictAlert message={t({ ko: '다른 곳에서 이 스타일의 같은 항목이 바뀌었어. 고친 내용은 그대로 있어.', en: 'The same fields of this style changed elsewhere. Your edits are kept.' })}>
          <Button size="sm" variant="secondary" disabled={editor.saving} onClick={editor.reload}>{t({ ko: '다시 불러오기', en: 'Reload' })}</Button>
          <SaveConflictOverwriteButton disabled={editor.saving} onClick={() => { editor.keepMine(); void editor.save().catch(() => undefined) }} />
        </SaveConflictAlert>
      ) : null}
      {/* Two columns from lg; the foldable's inner screen and phones stack them (images first). */}
      <div className={cn('grid min-w-0 gap-x-8 gap-y-6', canViewImages && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]')}>
        {canViewImages ? (
          <div className="min-w-0">
            <ReferenceImageGallery
              items={images}
              source={imageSource}
              // Picks and uploads wait in the draft (uploads staged, never in the library); 저장 copies them into the style.
              adder={{
                button: (disabled) => <ArtStyleImageAdd disabled={disabled} busy={busy} room={ART_STYLE_LIMITS.images - images.length} canUpload={canUpload} canPickFiles={canPickFiles} onAdd={appendImages} onUpload={(files) => void editor.stageUploads(files)} />,
                upload: canUpload ? (files) => editor.stageUploads(files.slice(0, ART_STYLE_LIMITS.images - editor.draftRef.current.images.length)) : null,
              }}
              editable={editable}
              busy={busy}
              onBusyChange={editor.onBusyChange}
              uploadTarget={null}
              isCurrent={editor.isCurrent}
              onReorder={(key, before) => setImages((current) => {
                const moved = current.find((item) => artStyleImageKey(item) === key)
                const target = current.find((item) => artStyleImageKey(item) === before)
                if (!moved || !target || moved === target) return current
                const next = current.filter((item) => item !== moved)
                next.splice(next.indexOf(target), 0, moved)
                return next
              })}
              heading={t({ ko: '참고 이미지', en: 'Reference images' })}
              count={`${images.length} / ${ART_STYLE_LIMITS.images}`}
              full={images.length >= ART_STYLE_LIMITS.images}
              emptyLabel={t({ ko: '참고 이미지가 없어.', en: 'No reference images.' })}
              ariaLabel={t({ ko: '참고 이미지', en: 'Reference images' })}
              imageLabel={(hash) => t({ ko: '참고 이미지 {index}', en: 'Reference image {index}' }, { index: images.indexOf(hash) + 1 })}
              imageBadges={(hash) => hash === images[0] ? <Badge variant="overlay" size="xs"><Star />{t({ ko: '대표', en: 'Cover' })}</Badge> : null}
              imageMenu={(hash, disabled) => [
                { key: 'cover', label: t({ ko: '대표로', en: 'Use as cover' }), icon: ArrowUpToLine, disabled: disabled || hash === images[0], onSelect: () => moveFirst(hash) },
                '-',
                { key: 'remove', label: t({ ko: '빼기', en: 'Remove' }), icon: X, destructive: true, disabled, onSelect: () => setImages((current) => current.filter((item) => artStyleImageKey(item) !== hash)) },
              ]}
            />
          </div>
        ) : null}
        <div className="min-w-0 space-y-4">
          <Field label={t({ ko: '설명', en: 'Description' })}>
            <Input variant="settings" value={draft.description} maxLength={ART_STYLE_LIMITS.description} readOnly={!editable}
              onChange={(event) => editor.patch({ description: event.target.value.replace(/[\r\n]+/g, ' ') })} />
          </Field>
          <FieldGroup label={t({ ko: '배지 {count}/{max}', en: 'Badges {count}/{max}' }, { count: draft.badges.length, max: ART_STYLE_LIMITS.badges })}>
            <ChipListInput items={draft.badges} editable={editable} disabled={busy}
              onAdd={(text) => editor.patch({ badges: addTerm(editor.draftRef.current.badges, text, ART_STYLE_LIMITS.badges) })}
              onRemove={(index) => editor.patch({ badges: editor.draftRef.current.badges.filter((_, at) => at !== index) })}
              addLabel={t({ ko: '배지 추가', en: 'Add badge' })} placeholder={t({ ko: '+ 배지', en: '+ badge' })}
              maxLength={ART_STYLE_LIMITS.badge} full={draft.badges.length >= ART_STYLE_LIMITS.badges}
              suggestions={allBadges.data?.map((entry) => entry.badge)} />
          </FieldGroup>
          <FieldGroup label={t({ ko: '검색어 {count}/{max}', en: 'Keywords {count}/{max}' }, { count: draft.keywords.length, max: ART_STYLE_LIMITS.keywords })}>
            <ChipListInput items={draft.keywords} editable={editable} disabled={busy}
              onAdd={(text) => editor.patch({ keywords: addTerm(editor.draftRef.current.keywords, text, ART_STYLE_LIMITS.keywords) })}
              onRemove={(index) => editor.patch({ keywords: editor.draftRef.current.keywords.filter((_, at) => at !== index) })}
              addLabel={t({ ko: '검색어 추가', en: 'Add keyword' })} placeholder={t({ ko: '+ 검색어', en: '+ keyword' })}
              maxLength={ART_STYLE_LIMITS.keyword} full={draft.keywords.length >= ART_STYLE_LIMITS.keywords} />
          </FieldGroup>
          <FramedField label={t({ ko: '프롬프트', en: 'Prompt' })}>
            <div className="flex flex-wrap items-center justify-between border-b border-line">
              <FieldTabs value={promptTab} onChange={setPromptTab} bare ariaLabel={t({ ko: '프롬프트 종류', en: 'Prompt kind' })} items={[
                { value: 'positive', label: t({ ko: '긍정', en: 'Positive' }) },
                { value: 'negative', label: t({ ko: '부정', en: 'Negative' }) },
              ]} />
              <div className="flex items-center gap-1 px-1">
                <span className="text-xs text-muted-foreground tabular-nums">{prompt.length} / {ART_STYLE_LIMITS.prompt}</span>
                <IconButton size="icon-sm" variant="ghost" label={promptTab === 'positive' ? t({ ko: '긍정 프롬프트 복사', en: 'Copy positive prompt' }) : t({ ko: '부정 프롬프트 복사', en: 'Copy negative prompt' })} disabled={!prompt} onClick={() => void copyPrompt()}><Copy /></IconButton>
              </div>
            </div>
            <div className="px-3 py-1">
              <Textarea variant="inline" rows={8} mono textSize="xs" value={prompt} maxLength={ART_STYLE_LIMITS.prompt} readOnly={!editable}
                aria-label={promptTab === 'positive' ? t({ ko: '긍정 프롬프트', en: 'Positive prompt' }) : t({ ko: '부정 프롬프트', en: 'Negative prompt' })}
                onChange={(event) => editor.patch({ [promptTab]: event.target.value })} />
            </div>
          </FramedField>
        </div>
      </div>
    </ModalBody>
  )
}
