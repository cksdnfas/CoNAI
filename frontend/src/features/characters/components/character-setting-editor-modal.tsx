import { useState } from 'react'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { ChevronDown, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { ErrorState } from '@/components/ui/error-state'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { CHAT_DOCK_INSET } from '@/features/settings/components/use-settings-editor-chat-page'
import { useI18n } from '@/i18n'
import type { CharacterFolder } from '@/lib/api-character-library'
import { folderPath } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { useCharacterSettingRuns } from '../use-character-setting-runs'
import { CharacterFolderPickerModal } from './character-folder-nav'
import { CharacterSettingAppearanceEditor } from './character-setting-appearance'

/**
 * Edit one appearance setting: its name, folder and look (the same appearance editor as a chat profile's). Without
 * `characters.edit` it only shows; image generation, imports and expressions are for administrators.
 */
export function CharacterSettingEditorModal({ editor, folders, canEdit, admin, onClose }: {
  editor: CharacterSettingEditorState
  folders: CharacterFolder[]
  canEdit: boolean
  admin: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const [assetImports, setAssetImports] = useState(0)
  const busy = assetImports > 0
  const onBusyChange = (next: boolean) => setAssetImports((count) => Math.max(0, count + (next ? 1 : -1)))
  const [pickingFolder, setPickingFolder] = useState(false)
  const { base, draft } = editor
  const generation = canEdit && admin
  const runs = useCharacterSettingRuns(editor, generation)
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathLabel = [t({ ko: '최상위', en: 'Top level' }), ...folderPath(byId, draft.folderId).map((folder) => folder.name)].join(' / ')
  const save = () => { if (canEdit && editor.canSave && !busy) void editor.save().catch(() => undefined) }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={canEdit && editor.dirty}
      onSave={canEdit ? save : undefined}
      title={base ? (canEdit ? t({ ko: '외형 설정 편집', en: 'Edit appearance setting' }) : t({ ko: '외형 설정', en: 'Appearance setting' })) : t({ ko: '새 외형 설정', en: 'New appearance setting' })}
      widthClassName="max-w-4xl"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
    >
      {editor.loading ? <ModalBody><LoadingState variant="inline" /></ModalBody> : editor.error ? (
        <ModalBody><ErrorState title={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load the setting' })} error={editor.error} onRetry={editor.retry} /></ModalBody>
      ) : <>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t({ ko: '이름', en: 'Name' })}>
              <Input variant="settings" value={draft.name} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} readOnly={!canEdit} aria-invalid={canEdit && !draft.name.trim() ? true : undefined} placeholder={t({ ko: '기본, 수영복…', en: 'Default, swimsuit…' })} onChange={(event) => editor.patch({ name: event.target.value })} />
            </Field>
            <FieldGroup label={t({ ko: '폴더', en: 'Folder' })}>
              <Button type="button" variant="field" size="field" className="w-full" disabled={!canEdit} onClick={() => setPickingFolder(true)}>
                <span className="flex min-w-0 items-center gap-2"><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{pathLabel}</span></span>
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </FieldGroup>
          </div>
          {base?.linkedProfileCount ? (
            <p className="text-xs text-muted-foreground">{base.linkedProfiles.length
              ? t({ ko: '연결된 프로필: {names}', en: 'Linked profiles: {names}' }, { names: base.linkedProfiles.map((profile) => profile.name).join(', ') })
              : t({ ko: '연결된 프로필 {count}개', en: '{count} linked profiles' }, { count: base.linkedProfileCount })}</p>
          ) : null}
          <CharacterSettingAppearanceEditor editor={editor} runs={runs} editable={canEdit} generation={generation} busy={busy} onBusyChange={onBusyChange} />
        </div>
        {canEdit ? (
          <EditorFooter
            // Failures are already reported by the editor (preview and delete snackbars).
            onDelete={base ? () => void editor.remove(true).catch(() => undefined) : undefined}
            deleteDisabled={busy}
            deleting={editor.deleting}
            onSave={save}
            canSave={editor.canSave && !busy}
            saving={editor.saving}
          />
        ) : null}
      </>}
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
    </Modal>
  )
}
