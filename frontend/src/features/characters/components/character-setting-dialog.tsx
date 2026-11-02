import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CHAT_PROFILE_TEXT_LIMITS, composeCharacterAppearance } from '@conai/shared'
import { ChevronLeft, ChevronRight, Copy, FolderInput, Image, Link2, Smile, Sparkles, Star, Tags, Trash2 } from 'lucide-react'
import { EditorTitleInput } from '@/components/common/editor-page'
import { TextTabs } from '@/components/common/text-tabs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import type { CharacterAppearanceTab } from '@/features/settings/components/character-appearance-editor'
import { useCharacterGroups } from '@/features/settings/components/chat-profile-asset-slots'
import { CHAT_DOCK_INSET } from '@/features/settings/components/use-settings-editor-chat-page'
import { useI18n } from '@/i18n'
import type { CharacterFolder, CharacterSettingSummary } from '@/lib/api-character-library'
import { chatAssetCandidatesQueryKey } from '@/lib/api-codex-chat'
import { getGroupImages } from '@/lib/api-groups'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { formatShortcut, isTypingTarget, openDialogCount } from '@/lib/keyboard-shortcut'
import { characterImageUrl, emptySettingDraft, localizedTagName, settingDraftOf } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { useCharacterSettingRuns } from '../use-character-setting-runs'
import { CharacterFolderPickerModal } from './character-folder-nav'
import { CharacterSettingAppearanceEditor } from './character-setting-appearance'

type DialogProps = {
  editor: CharacterSettingEditorState
  folders: CharacterFolder[]
  /** The settings loaded in the library list, in order. */
  items: CharacterSettingSummary[]
  /** Every setting of the list's scope (the counter's total). */
  total: number
  /** Loads the list's next batch (null when everything is loaded) and resolves to the loaded settings after it. */
  onLoadMore: (() => Promise<CharacterSettingSummary[]>) | null
  canEdit: boolean
  admin: boolean
  tab: CharacterAppearanceTab
  onTabChange: (tab: CharacterAppearanceTab) => void
  onOpen: (id: number) => void
  onClose: () => void
  onToggleFavorite: (setting: CharacterSettingSummary) => void
}

/**
 * One appearance setting over the library (`setting=<id>` or `new=<folder>`): the name as the title, the reference and
 * avatar beside the tabs, stepping through the listed settings (the next batch loads at the end of the list) and saving
 * in the footer. Closing goes through the URL, so the library's leave guard asks once about unsaved edits. Without
 * `characters.edit` it only shows; image generation is for administrators.
 */
export function CharacterSettingDialog({ editor, folders, items, total, onLoadMore, canEdit, admin, tab, onTabChange, onOpen, onClose, onToggleFavorite }: DialogProps) {
  const { t, language } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [moving, setMoving] = useState(false)
  const footer = useRef<HTMLDivElement | null>(null)
  const { base, draft, busy } = editor
  const save = () => { if (canEdit && editor.dirty && editor.canSave && !busy) void editor.save().catch(() => undefined) }
  const work = base?.copyright ? localizedTagName(language, base.copyright, base.copyrightTranslated) : ''
  const synced = base?.linkedProfileCount ?? 0
  // The position comes from the address, so ‹ › stay (with their focus) while the next setting loads.
  const openId = editor.target && 'settingId' in editor.target ? editor.target.settingId : null
  const index = openId === null ? -1 : items.findIndex((item) => item.id === openId)
  const atEnd = index === items.length - 1
  const step = async (direction: -1 | 1) => {
    if (busy || index < 0) return
    const stillOpen = editor.isCurrent
    let list = items
    if (direction > 0 && atEnd && onLoadMore) {
      try { list = await onLoadMore() } catch (error) {
        showSnackbar({ message: getErrorMessage(error, t({ ko: '다음 외형 설정을 불러오지 못했어.', en: 'Could not load more settings.' })), tone: 'error' })
        return
      }
    }
    // Closed or moved on while the batch loaded: a late batch must not reopen or jump the dialog.
    const next = list[index + direction]
    if (next && stillOpen() && !editor.isBusy()) onOpen(next.id)
  }
  // ← → step unless a field, menu or tab strip has the keys, or another dialog is open over this one.
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTypingTarget(event) || openDialogCount() > 1) return
    if (event.target instanceof Element && event.target.closest('[role="menu"],[role="tablist"],[data-chat-dock]')) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void step(event.key === 'ArrowLeft' ? -1 : 1) }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboard(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
  // Stepping rebuilds the body and can disable ‹ ›; focus lost with either returns to the dialog, so Tab, Ctrl+S and
  // ← → stay here (a browser may drop focus from a disabled button only later).
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body || active.matches(':disabled')) footer.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
  }, [editor.session])
  const revert = async () => {
    if (await confirm({ title: t({ ko: '변경 되돌리기', en: 'Revert changes' }), description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }), confirmLabel: t({ ko: '되돌리기', en: 'Revert' }), tone: 'destructive' })) editor.patch(base ? settingDraftOf(base) : emptySettingDraft(draft.folderId))
  }
  const copy = async () => {
    try {
      await copyTextToClipboard(composeCharacterAppearance(draft))
      showSnackbar({ message: t({ ko: '외형 태그를 복사했어.', en: 'Copied the appearance tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }
  return (
    <Modal
      open
      size="xl"
      height="tall"
      // The docked chat stays usable beside the dialog: the assistant fills and saves the open setting.
      sidePanelInset={CHAT_DOCK_INSET}
      // The URL is the dialog's address: browser back leaves the setting through the library's guard.
      closeOnBack={false}
      title={editor.ready
        ? <EditorTitleInput as="span" value={draft.name} label={t({ ko: '외형 설정 이름', en: 'Setting name' })} placeholder={t({ ko: '이름', en: 'Name' })} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} readOnly={!canEdit} onChange={(name) => editor.patch({ name })} />
        : t({ ko: '외형 설정', en: 'Appearance setting' })}
      leading={editor.ready ? <ChatProfileAvatar name={draft.name || '?'} imageUrl={draft.avatarHash ? characterImageUrl(draft.avatarHash) : null} avatarCrop={draft.avatarCrop} engine="llm" size="xl" className="size-10" /> : undefined}
      description={editor.ready ? [work, t({ ko: '의상 {count}벌', en: '{count} outfits' }, { count: draft.outfits.length })].filter(Boolean).join(' · ') : undefined}
      status={synced ? <Chip tone="primary" size="sm"><Link2 />{t({ ko: '프로필 {count}개와 동기화', en: 'Synced with {count} profiles' }, { count: synced })}</Chip> : undefined}
      onSave={canEdit ? save : undefined}
      onClose={onClose}
    >
      {/* Per setting: its runs, counts and pickers start fresh while the dialog, its footer and focus stay. */}
      <CharacterSettingBody key={editor.session} editor={editor} canEdit={canEdit} admin={admin} tab={tab} onTabChange={onTabChange} />
      <ModalFooter ref={footer} separated>
        {index >= 0 ? <>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '이전 설정', en: 'Previous setting' })} disabled={busy || index === 0} onClick={() => void step(-1)}><ChevronLeft /></IconButton>
          <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums">{index + 1} / {total}</span>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '다음 설정', en: 'Next setting' })} disabled={busy || (atEnd && !onLoadMore)} onClick={() => void step(1)}><ChevronRight /></IconButton>
        </> : null}
        {canEdit && base ? <IconButton variant="ghost" size="icon-sm" active={base.favorite} disabled={busy} label={base.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })} onClick={() => onToggleFavorite(base)}><Star className={base.favorite ? 'fill-current' : undefined} /></IconButton> : null}
        {editor.ready ? <ActionMenuButton label={t({ ko: '외형 설정 작업', en: 'Setting actions' })} entries={[
          canEdit ? { key: 'move', label: t({ ko: '다른 폴더로 옮기기', en: 'Move to…' }), icon: FolderInput, disabled: busy, onSelect: () => setMoving(true) } : null,
          { key: 'copy', label: t({ ko: '태그 복사', en: 'Copy tags' }), icon: Copy, onSelect: () => void copy() },
          canEdit && base ? '-' : null,
          // Failures are already reported by the editor (preview and delete snackbars).
          canEdit && base ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy || editor.deleting, onSelect: () => void editor.remove(true).catch(() => undefined) } : null,
        ]} /> : null}
        <span className="flex-1" />
        {canEdit && editor.ready ? <>
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">{editor.dirty ? t({ ko: '저장 안 한 변경 · {keys}', en: 'Unsaved changes · {keys}' }, { keys: formatShortcut('Mod+S') }) : t({ ko: '저장됨', en: 'Saved' })}</span>
          <Button size="sm" variant="ghost" disabled={!editor.dirty || busy || editor.saving} onClick={() => void revert()}>{t({ ko: '되돌리기', en: 'Revert' })}</Button>
          <Button size="sm" disabled={!editor.dirty || !editor.canSave || busy} aria-busy={editor.saving} onClick={save}>{t({ ko: '저장', en: 'Save' })}</Button>
        </> : null}
      </ModalFooter>
      {moving ? <CharacterFolderPickerModal title={t({ ko: '폴더 고르기', en: 'Choose folder' })} folders={folders} value={draft.folderId} submitLabel={t({ ko: '선택', en: 'Select' })} onPick={(folderId) => { editor.patch({ folderId }); setMoving(false) }} onClose={() => setMoving(false)} /> : null}
    </Modal>
  )
}

function CharacterSettingBody({ editor, canEdit, admin, tab, onTabChange }: Pick<DialogProps, 'editor' | 'canEdit' | 'admin' | 'tab' | 'onTabChange'>) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { base, draft, busy } = editor
  const runs = useCharacterSettingRuns(editor, canEdit && admin)
  const source = { expressionGroupId: base?.expressionGroupId ?? null, candidateGroupId: base?.candidateGroupId ?? null }
  const groups = useCharacterGroups(source)
  const candidates = useQuery({
    queryKey: [...chatAssetCandidatesQueryKey(source.candidateGroupId ?? 0), 'count'],
    queryFn: ({ signal }) => getGroupImages(source.candidateGroupId!, { limit: 1 }, { signal }),
    enabled: canViewImages && source.candidateGroupId !== null,
  })

  return (
    <ModalBody spacing="none">
      {editor.loading ? <LoadingState variant="inline" /> : editor.error ? <ErrorState title={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load the setting' })} error={editor.error} onRetry={editor.retry} /> : editor.ready ? (
        <CharacterSettingAppearanceEditor
          editor={editor}
          runs={runs}
          editable={canEdit}
          generation={canEdit && admin}
          busy={busy}
          onBusyChange={editor.onBusyChange}
          tab={tab}
          tabs={<TextTabs value={tab} onChange={(value) => { if (!busy) onTabChange(value) }} ariaLabel={t({ ko: '외형 설정 탭', en: 'Setting tabs' })} items={[
            { value: 'tags', label: t({ ko: '태그', en: 'Tags' }), icon: Tags },
            { value: 'images', label: t({ ko: '참고 이미지', en: 'References' }), icon: Image, count: draft.references.length },
            { value: 'expressions', label: t({ ko: '표정', en: 'Expressions' }), icon: Smile, count: groups.entries.length },
            { value: 'candidates', label: t({ ko: '생성 후보', en: 'Candidates' }), icon: Sparkles, count: candidates.data?.pagination.total ?? 0 },
          ]} />}
        />
      ) : null}
    </ModalBody>
  )
}
