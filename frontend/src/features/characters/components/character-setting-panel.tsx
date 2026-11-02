import { useEffect, useEffectEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CHAT_PROFILE_TEXT_LIMITS, composeCharacterAppearance } from '@conai/shared'
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FolderInput, Image, Link2, Maximize2, Smile, Sparkles, Star, Tags, Trash2, Undo2, X } from 'lucide-react'
import { EditorTitleInput } from '@/components/common/editor-page'
import { TextTabs } from '@/components/common/text-tabs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import type { CharacterAppearanceTab } from '@/features/settings/components/character-appearance-editor'
import { useCharacterGroups } from '@/features/settings/components/chat-profile-asset-slots'
import { useI18n } from '@/i18n'
import type { CharacterFolder, CharacterSettingSummary } from '@/lib/api-character-library'
import { chatAssetCandidatesQueryKey } from '@/lib/api-codex-chat'
import { getGroupImages } from '@/lib/api-groups'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { hasOpenDialog, usePageSaveShortcut } from '@/lib/keyboard-shortcut'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { characterImageUrl, emptySettingDraft, localizedTagName, settingDraftOf } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { useCharacterSettingRuns } from '../use-character-setting-runs'
import { CharacterFolderPickerModal } from './character-folder-nav'
import { CharacterSettingAppearanceEditor } from './character-setting-appearance'

export function CharacterSettingPanel({ editor, folders, items, canEdit, admin, tab, onTabChange, onOpen, onExpand, onClose, onToggleFavorite }: {
  editor: CharacterSettingEditorState
  folders: CharacterFolder[]
  items: CharacterSettingSummary[]
  canEdit: boolean
  admin: boolean
  tab: CharacterAppearanceTab
  onTabChange: (tab: CharacterAppearanceTab) => void
  onOpen: (id: number) => void
  onExpand: () => void
  onClose: () => void
  onToggleFavorite: (setting: CharacterSettingSummary) => void
}) {
  const { t, language } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const { canViewImages } = useImagePermissions()
  const [moving, setMoving] = useState(false)
  const busy = editor.busy
  const onBusyChange = editor.onBusyChange
  const { base, draft } = editor
  const runs = useCharacterSettingRuns(editor, canEdit && admin)
  const source = { expressionGroupId: base?.expressionGroupId ?? null, candidateGroupId: base?.candidateGroupId ?? null }
  const groups = useCharacterGroups(source)
  const candidates = useQuery({
    queryKey: [...chatAssetCandidatesQueryKey(source.candidateGroupId ?? 0), 'count'],
    queryFn: ({ signal }) => getGroupImages(source.candidateGroupId!, { limit: 1 }, { signal }),
    enabled: canViewImages && source.candidateGroupId !== null,
  })
  const index = items.findIndex((item) => item.id === base?.id)
  const step = (direction: number) => { const next = index >= 0 ? items[index + direction] : undefined; if (next && !busy) onOpen(next.id) }
  const save = () => { if (canEdit && editor.dirty && editor.canSave && !busy) void editor.save().catch(() => undefined) }
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.isComposing || event.repeat || hasOpenDialog() || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="menu"],[role="tablist"],[data-chat-dock]')) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1) }
  })
  usePageSaveShortcut(canEdit ? save : undefined, busy)
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboard(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
  const revert = async () => {
    if (await confirm({ title: t({ ko: '변경 되돌리기', en: 'Revert changes' }), description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }), confirmLabel: t({ ko: '되돌리기', en: 'Revert' }), tone: 'destructive' })) editor.patch(base ? settingDraftOf(base) : emptySettingDraft(draft.folderId))
  }
  const copy = async () => {
    try {
      await copyTextToClipboard(composeCharacterAppearance(draft))
      showSnackbar({ message: t({ ko: '외형 태그를 복사했어.', en: 'Copied the appearance tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }
  const work = base?.copyright ? localizedTagName(language, base.copyright, base.copyrightTranslated) : ''
  const synced = base?.linkedProfileCount ?? 0
  return <aside className="flex min-h-0 w-full min-w-0 flex-col border-l border-line bg-surface-low xl:w-120 xl:shrink-0" aria-label={t({ ko: '외형 설정 상세', en: 'Appearance setting details' })}>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
      <IconButton variant="ghost" size="icon-sm" className="xl:hidden" label={t({ ko: '목록으로', en: 'Back to library' })} disabled={busy} onClick={onClose}><ArrowLeft /></IconButton>
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '이전 설정', en: 'Previous setting' })} disabled={busy || index <= 0} onClick={() => step(-1)}><ChevronLeft /></IconButton>
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '다음 설정', en: 'Next setting' })} disabled={busy || index < 0 || index >= items.length - 1} onClick={() => step(1)}><ChevronRight /></IconButton>
      <span className="text-xs text-muted-foreground tabular-nums">{index >= 0 ? index + 1 : '–'} / {items.length}</span>
      <span className="flex-1" />
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '전체 편집기로', en: 'Open full editor' })} disabled={busy} onClick={onExpand}><Maximize2 /></IconButton>
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '닫기', en: 'Close' })} disabled={busy} onClick={onClose}><X /></IconButton>
    </div>
    {editor.ready ? <>
      <div className="flex shrink-0 items-center gap-3 p-4">
        <ChatProfileAvatar name={draft.name || '?'} imageUrl={draft.avatarHash ? characterImageUrl(draft.avatarHash) : null} avatarCrop={draft.avatarCrop} engine="llm" size="xl" className="size-14" />
        <div className="min-w-0 flex-1">
          <EditorTitleInput value={draft.name} label={t({ ko: '외형 설정 이름', en: 'Setting name' })} placeholder={t({ ko: '이름', en: 'Name' })} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} readOnly={!canEdit} onChange={(name) => editor.patch({ name })} />
          <p className="truncate text-xs text-muted-foreground">{[work, t({ ko: '의상 {count}벌', en: '{count} outfits' }, { count: draft.outfits.length })].filter(Boolean).join(' · ')}</p>
          {synced ? <Chip tone="primary" size="sm"><Link2 />{t({ ko: '프로필 {count}개와 동기화', en: 'Synced with {count} profiles' }, { count: synced })}</Chip> : null}
        </div>
        {canEdit && base ? <IconButton variant="ghost" size="icon-sm" active={base.favorite} disabled={busy} label={base.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })} onClick={() => onToggleFavorite(base)}><Star className={base.favorite ? 'fill-current' : undefined} /></IconButton> : null}
        <ActionMenuButton label={t({ ko: '외형 설정 작업', en: 'Setting actions' })} entries={[
          canEdit ? { key: 'move', label: t({ ko: '다른 폴더로 옮기기', en: 'Move to…' }), icon: FolderInput, disabled: busy, onSelect: () => setMoving(true) } : null,
          { key: 'copy', label: t({ ko: '태그 복사', en: 'Copy tags' }), icon: Copy, onSelect: () => void copy() },
          canEdit && base ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy || editor.deleting, onSelect: () => void editor.remove(true).catch(() => undefined) } : null,
        ]} />
      </div>
      <TextTabs value={tab} onChange={(value) => { if (!busy) onTabChange(value) }} stripClassName="px-3" ariaLabel={t({ ko: '외형 설정 탭', en: 'Setting tabs' })} items={[
        { value: 'tags', label: t({ ko: '태그', en: 'Tags' }), icon: Tags },
        { value: 'images', label: t({ ko: '이미지', en: 'Images' }), icon: Image, count: draft.references.length },
        { value: 'expressions', label: t({ ko: '표정', en: 'Expressions' }), icon: Smile, count: groups.entries.length },
        { value: 'candidates', label: t({ ko: '생성 후보', en: 'Candidates' }), icon: Sparkles, count: candidates.data?.pagination.total ?? 0 },
      ]} />
    </> : null}
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {editor.loading ? <LoadingState variant="inline" /> : editor.error ? <ErrorState title={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load the setting' })} error={editor.error} onRetry={editor.retry} /> : editor.ready ? (
        <CharacterSettingAppearanceEditor editor={editor} runs={runs} editable={canEdit} generation={canEdit && admin} busy={busy} onBusyChange={onBusyChange} tab={tab} />
      ) : null}
    </div>
    {canEdit && editor.ready ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-container px-3 py-2" role="region" aria-label={t({ ko: '저장', en: 'Save' })}>
      <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">{editor.dirty ? t({ ko: '저장 안 한 변경', en: 'Unsaved changes' }) : t({ ko: '저장됨', en: 'Saved' })}</span>
      <Button size="compact" variant="ghost" disabled={!editor.dirty || busy || editor.saving} onClick={() => void revert()}><Undo2 />{t({ ko: '되돌리기', en: 'Revert' })}</Button>
      <Button size="compact" disabled={!editor.dirty || !editor.canSave || busy} aria-busy={editor.saving} onClick={save}>{t({ ko: '저장', en: 'Save' })}<kbd className="text-2xs">Ctrl S</kbd></Button>
    </div> : null}
    {moving ? <CharacterFolderPickerModal title={t({ ko: '폴더 고르기', en: 'Choose folder' })} folders={folders} value={draft.folderId} submitLabel={t({ ko: '선택', en: 'Select' })} onPick={(folderId) => { editor.patch({ folderId }); setMoving(false) }} onClose={() => setMoving(false)} /> : null}
  </aside>
}
