import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { FolderInput, Link2, Minimize2, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { EditorPage, EditorTitleInput } from '@/components/common/editor-page'
import type { PathCrumb } from '@/components/common/path-breadcrumbs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorGroup } from '@/components/ui/editor-group'
import { ErrorState } from '@/components/ui/error-state'
import { FloatingSaveBar } from '@/components/ui/floating-save-bar'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import type { CharacterFolder } from '@/lib/api-character-library'
import { emptySettingDraft, folderPath, settingDraftOf } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { useCharacterSettingRuns } from '../use-character-setting-runs'
import { CharacterFolderPickerModal } from './character-folder-nav'
import { CharacterSettingAppearanceEditor } from './character-setting-appearance'

/**
 * One appearance setting expanded with `editor=full` (setting=<id> or new=<folder>): the folder path back,
 * the name as the heading with the synced-profile count, the images and the profiles synced to it on the left, the
 * appearance, expressions and candidates on the right, and the save bar while something is unsaved. Without
 * `characters.edit` it only shows; image generation is for administrators.
 */
export function CharacterSettingEditorPage({ editor, folders, canEdit, admin, rootLabel, onOpenFolder, onOpenPanel }: {
  editor: CharacterSettingEditorState
  folders: CharacterFolder[]
  canEdit: boolean
  admin: boolean
  rootLabel: string
  onOpenFolder: (folderId: number | null) => void
  onOpenPanel: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const busy = editor.busy
  const onBusyChange = editor.onBusyChange
  const [pickingFolder, setPickingFolder] = useState(false)
  // A new setting starts without a name: mark it only after the user has typed in the field.
  const [nameTouched, setNameTouched] = useState(false)
  const { base, draft } = editor
  const generation = canEdit && admin
  const runs = useCharacterSettingRuns(editor, generation)
  const dirty = canEdit && editor.dirty
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const crumbs: PathCrumb[] = [
    { key: 'root', label: rootLabel, onClick: () => onOpenFolder(null) },
    ...folderPath(byId, draft.folderId).map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => onOpenFolder(folder.id) })),
  ]
  const save = () => { if (canEdit && editor.canSave && !busy) void editor.save().catch(() => undefined) }
  const revert = async () => {
    const ok = await confirm({
      title: t({ ko: '변경 되돌리기', en: 'Revert changes' }),
      description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }),
      confirmLabel: t({ ko: '되돌리기', en: 'Revert' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (ok) editor.patch(base ? settingDraftOf(base) : emptySettingDraft(draft.folderId))
  }
  const synced = base?.linkedProfileCount ?? 0

  const status = !editor.ready ? null : base
    ? (synced ? <Chip tone="primary" size="sm"><Link2 />{t({ ko: '프로필 {count}개와 동기화', en: 'Synced with {count} profiles' }, { count: synced })}</Chip> : null)
    : <Chip tone="muted" size="sm">{t({ ko: '아직 저장 안 한 새 설정', en: 'New, not saved yet' })}</Chip>
  const actions = canEdit && editor.ready ? (
    <ActionMenuButton
      label={t({ ko: '외형 설정 작업', en: 'Setting actions' })}
      entries={[
        { key: 'move', label: t({ ko: '다른 폴더로 옮기기', en: 'Move to…' }), icon: FolderInput, disabled: busy, onSelect: () => setPickingFolder(true) },
        base ? '-' : null,
        // Failures are already reported by the editor (preview and delete snackbars).
        base ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy || editor.deleting, onSelect: () => void editor.remove(true).catch(() => undefined) } : null,
      ]}
    />
  ) : null

  const aside = synced ? (
    <EditorGroup label={t({ ko: '동기화 중인 프로필', en: 'Synced profiles' })} count={synced}>
      {base?.linkedProfiles.length ? (
        <ul>
          {base.linkedProfiles.map((profile) => (
            <li key={profile.id}>
              <ListRow asChild interactive size="sm">
                <Link to={`/chat/profiles?profile=${profile.id}`}><span className="truncate">{profile.name}</span></Link>
              </ListRow>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">{t({ ko: '프로필 이름은 관리자만 볼 수 있어.', en: 'Only administrators see the profile names.' })}</p>}
    </EditorGroup>
  ) : null

  return (
    <EditorPage
      crumbs={crumbs}
      title={editor.ready
        ? <EditorTitleInput value={draft.name} label={t({ ko: '외형 설정 이름', en: 'Setting name' })} placeholder={t({ ko: '이름 (기본, 수영복…)', en: 'Name (default, swimsuit…)' })} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} readOnly={!canEdit} invalid={canEdit && nameTouched && !draft.name.trim()} onChange={(name) => { setNameTouched(true); editor.patch({ name }) }} />
        : t({ ko: '외형 설정', en: 'Appearance setting' })}
      status={status}
      actions={<><IconButton variant="ghost" size="icon-sm" label={t({ ko: '상세 패널로', en: 'Back to detail panel' })} disabled={busy} onClick={onOpenPanel}><Minimize2 /></IconButton>{actions}</>}
      onSave={canEdit ? save : undefined}
      saveBar={dirty || editor.saving ? (
        <FloatingSaveBar
          label={base ? t({ ko: '저장 안 한 변경', en: 'Unsaved changes' }) : t({ ko: '새 외형 설정', en: 'New setting' })}
          saving={editor.saving || busy}
          canSave={editor.canSave && !busy}
          onSave={save}
          onDiscard={() => void revert()}
        />
      ) : null}
    >
      {editor.loading ? <LoadingState variant="inline" /> : editor.error ? (
        <ErrorState title={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load the setting' })} error={editor.error} onRetry={editor.retry} />
      ) : (
        <CharacterSettingAppearanceEditor
          editor={editor}
          runs={runs}
          editable={canEdit}
          generation={generation}
          busy={busy}
          onBusyChange={onBusyChange}
          appearanceNote={synced ? t({ ko: '저장하면 동기화 중인 프로필 {count}개에도 반영돼.', en: 'Saving also changes the {count} synced profiles.' }, { count: synced }) : null}
          aside={aside}
        />
      )}
      {pickingFolder ? (
        <CharacterFolderPickerModal
          title={t({ ko: '폴더 고르기', en: 'Choose folder' })}
          folders={folders}
          value={draft.folderId}
          submitLabel={t({ ko: '선택', en: 'Select' })}
          onPick={(folderId) => { editor.patch({ folderId }); setPickingFolder(false) }}
          onClose={() => setPickingFolder(false)}
        />
      ) : null}
    </EditorPage>
  )
}
