import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow } from './settings-primitives'
import { SettingsResourceCreateActionRow } from './settings-resource-shared'
import type { NewBackupSourceDraft } from '../settings-utils'

interface BackupSourceCreateFormProps {
  newBackupSource: NewBackupSourceDraft
  onNewBackupSourceChange: (patch: Partial<NewBackupSourceDraft>) => void
  backupPathValidationMessage: string | null
  isValidatingBackupPath: boolean
  isAddingBackupSource: boolean
  onValidateBackupPath: () => void
  onAddBackupSource: () => Promise<boolean>
}

export function BackupSourceCreateForm({
  newBackupSource,
  onNewBackupSourceChange,
  backupPathValidationMessage,
  isValidatingBackupPath,
  isAddingBackupSource,
  onValidateBackupPath,
  onAddBackupSource,
}: BackupSourceCreateFormProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsField label="source 폴더 경로">
          <Input variant="settings" value={newBackupSource.source_path} onChange={(event) => onNewBackupSourceChange({ source_path: event.target.value })} placeholder="D:\\Images\\Incoming" />
        </SettingsField>

        <SettingsField label="표시 이름">
          <Input variant="settings" value={newBackupSource.display_name} onChange={(event) => onNewBackupSourceChange({ display_name: event.target.value })} placeholder="Backup source A" />
        </SettingsField>

        <SettingsField label="uploads 대상 폴더명">
          <Input variant="settings" value={newBackupSource.target_folder_name} onChange={(event) => onNewBackupSourceChange({ target_folder_name: event.target.value })} placeholder="backup-a" />
        </SettingsField>

        <SettingsField label="가져오기 모드">
          <Select variant="settings" value={newBackupSource.import_mode} onChange={(event) => onNewBackupSourceChange({ import_mode: event.target.value as NewBackupSourceDraft['import_mode'] })}>
            <option value="copy_original">원본 복사</option>
            <option value="convert_webp">WebP 변환 (메타 보존)</option>
          </Select>
        </SettingsField>

        <SettingsField label="watcher polling(ms)">
          <Input type="number" min={100} variant="settings" value={newBackupSource.watcher_polling_interval} onChange={(event) => onNewBackupSourceChange({ watcher_polling_interval: Number(event.target.value) || 100 })} />
        </SettingsField>

        <SettingsField label="WebP 품질">
          <Input type="number" min={1} max={100} variant="settings" value={newBackupSource.webp_quality} onChange={(event) => onNewBackupSourceChange({ webp_quality: Number(event.target.value) || 90 })} disabled={newBackupSource.import_mode !== 'convert_webp'} />
        </SettingsField>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsToggleRow>
          <input type="checkbox" checked={newBackupSource.recursive} onChange={(event) => onNewBackupSourceChange({ recursive: event.target.checked })} />
          하위 폴더 포함
        </SettingsToggleRow>
        <SettingsToggleRow>
          <input type="checkbox" checked={newBackupSource.watcher_enabled} onChange={(event) => onNewBackupSourceChange({ watcher_enabled: event.target.checked })} />
          watcher 시작
        </SettingsToggleRow>
      </div>

      <SettingsResourceCreateActionRow
        validationMessage={backupPathValidationMessage}
        canValidate={Boolean(newBackupSource.source_path.trim())}
        isValidating={isValidatingBackupPath}
        validateLabel="source 경로 검증"
        onValidate={onValidateBackupPath}
        canSubmit={Boolean(newBackupSource.source_path.trim() && newBackupSource.target_folder_name.trim())}
        isSubmitting={isAddingBackupSource}
        submitLabel="백업 소스 추가"
        onSubmit={() => void onAddBackupSource()}
      />
    </div>
  )
}
