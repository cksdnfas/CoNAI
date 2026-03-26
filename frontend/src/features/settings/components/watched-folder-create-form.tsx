import { Input } from '@/components/ui/input'
import { SettingsField, SettingsToggleRow } from './settings-primitives'
import { SettingsResourceCreateActionRow } from './settings-resource-shared'
import type { NewWatchedFolderDraft } from '../settings-utils'

interface WatchedFolderCreateFormProps {
  newFolder: NewWatchedFolderDraft
  onNewFolderChange: (patch: Partial<NewWatchedFolderDraft>) => void
  pathValidationMessage: string | null
  isValidatingPath: boolean
  isAddingFolder: boolean
  onValidatePath: () => void
  onAddFolder: () => Promise<boolean>
}

export function WatchedFolderCreateForm({
  newFolder,
  onNewFolderChange,
  pathValidationMessage,
  isValidatingPath,
  isAddingFolder,
  onValidatePath,
  onAddFolder,
}: WatchedFolderCreateFormProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsField label="폴더 경로">
          <Input variant="settings" value={newFolder.folder_path} onChange={(event) => onNewFolderChange({ folder_path: event.target.value })} placeholder="D:\\Images\\Incoming" />
        </SettingsField>

        <SettingsField label="표시 이름">
          <Input variant="settings" value={newFolder.folder_name} onChange={(event) => onNewFolderChange({ folder_name: event.target.value })} placeholder="Incoming" />
        </SettingsField>

        <SettingsField label="스캔 주기(분)">
          <Input type="number" min={1} variant="settings" value={newFolder.scan_interval} onChange={(event) => onNewFolderChange({ scan_interval: Number(event.target.value) || 1 })} />
        </SettingsField>

        <SettingsField label="watcher polling(ms)">
          <Input type="number" min={100} variant="settings" value={newFolder.watcher_polling_interval} onChange={(event) => onNewFolderChange({ watcher_polling_interval: Number(event.target.value) || 100 })} />
        </SettingsField>

        <SettingsField label="제외 확장자">
          <Input variant="settings" value={newFolder.exclude_extensions} onChange={(event) => onNewFolderChange({ exclude_extensions: event.target.value })} placeholder="tmp, db" />
        </SettingsField>

        <SettingsField label="제외 패턴">
          <Input variant="settings" value={newFolder.exclude_patterns} onChange={(event) => onNewFolderChange({ exclude_patterns: event.target.value })} placeholder="@eaDir, cache" />
        </SettingsField>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SettingsToggleRow>
          <input type="checkbox" checked={newFolder.auto_scan} onChange={(event) => onNewFolderChange({ auto_scan: event.target.checked })} />
          자동 스캔
        </SettingsToggleRow>
        <SettingsToggleRow>
          <input type="checkbox" checked={newFolder.recursive} onChange={(event) => onNewFolderChange({ recursive: event.target.checked })} />
          하위 폴더 포함
        </SettingsToggleRow>
        <SettingsToggleRow>
          <input type="checkbox" checked={newFolder.watcher_enabled} onChange={(event) => onNewFolderChange({ watcher_enabled: event.target.checked })} />
          watcher 시작
        </SettingsToggleRow>
      </div>

      <SettingsResourceCreateActionRow
        validationMessage={pathValidationMessage}
        canValidate={Boolean(newFolder.folder_path.trim())}
        isValidating={isValidatingPath}
        validateLabel="경로 검증"
        onValidate={onValidatePath}
        canSubmit={Boolean(newFolder.folder_path.trim())}
        isSubmitting={isAddingFolder}
        submitLabel="감시 폴더 추가"
        onSubmit={() => void onAddFolder()}
      />
    </div>
  )
}
