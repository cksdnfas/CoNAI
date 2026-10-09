import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { SettingsResourceCreateActionRow } from './settings-resource-shared'
import { buildBackupTargetPreviewPath, type NewBackupSourceDraft } from '../settings-utils'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { SettingsLabelTip } from './settings-label-tip'

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
  const { t } = useI18n()

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t({ ko: 'source 폴더 경로', en: 'Source folder path' })}>
          <Input variant="settings" value={newBackupSource.source_path} onChange={(event) => onNewBackupSourceChange({ source_path: event.target.value })} placeholder="D:\\Images\\Incoming" />
        </Field>

        <Field label={t({ ko: '표시 이름', en: 'Display name' })}>
          <Input variant="settings" value={newBackupSource.display_name} onChange={(event) => onNewBackupSourceChange({ display_name: event.target.value })} placeholder={t({ ko: 'Backup source A', en: 'Backup source A' })} />
        </Field>

        <Field
          label={<SettingsLabelTip label={t({ ko: 'Upload 내부 대상 경로', en: 'Target path inside Upload' })} tip={t({ ko: '업로드 폴더 안의 상대 경로로 지정해.', en: 'Use a relative path inside the upload folder.' })} />}
        >
          <Input
            variant="settings"
            value={newBackupSource.target_folder_name}
            onChange={(event) => onNewBackupSourceChange({ target_folder_name: event.target.value })}
            placeholder={t({ ko: 'Backup 또는 Backup/001', en: 'Backup or Backup/001' })}
          />
          <p className="mt-2 break-all font-mono text-xs text-primary">{t({ ko: '최종 경로: {path}', en: 'Final path: {path}' }, { path: buildBackupTargetPreviewPath(newBackupSource.target_folder_name) })}</p>
        </Field>

        <Field label={t({ ko: '가져오기 모드', en: 'Import mode' })}>
          <Select variant="settings" value={newBackupSource.import_mode} onChange={(event) => onNewBackupSourceChange({ import_mode: event.target.value as NewBackupSourceDraft['import_mode'] })}>
            <option value="copy_original">{t({ ko: '원본 복사', en: 'Copy original' })}</option>
            <option value="convert_webp">{t({ ko: 'WebP 변환 (메타 보존)', en: 'Convert to WebP (preserve metadata)' })}</option>
          </Select>
        </Field>

        <Field label={<SettingsLabelTip label={t({ ko: '폴링 주기(ms)', en: 'Polling interval (ms)' })} tip={t({ ko: '비워두면 자동 (권장)', en: 'Empty = auto (recommended)' })} />}>
          <NumberStepperInput min={2000} allowEmpty variant="settings" value={newBackupSource.watcher_polling_interval} onValueCommit={(nextValue) => onNewBackupSourceChange({ watcher_polling_interval: nextValue === '' ? null : Number(nextValue) || null })} placeholder={t({ ko: '자동 감지', en: 'Auto detect' })} disabled={!newBackupSource.watcher_enabled} />
        </Field>

        <Field label={t({ ko: 'WebP 품질', en: 'WebP quality' })}>
          <NumberStepperInput min={1} max={100} variant="settings" value={newBackupSource.webp_quality} onValueCommit={(nextValue) => onNewBackupSourceChange({ webp_quality: Number(nextValue) || 90 })} disabled={newBackupSource.import_mode !== 'convert_webp'} />
        </Field>
      </div>

      <div>
        <SettingsSwitchRow
          checked={newBackupSource.recursive}
          onCheckedChange={(checked) => onNewBackupSourceChange({ recursive: checked })}
          label={t({ ko: '하위 폴더 포함', en: 'Include subfolders' })}
        />
        <SettingsSwitchRow
          checked={newBackupSource.watcher_enabled}
          onCheckedChange={(checked) => onNewBackupSourceChange({ watcher_enabled: checked })}
          label={t({ ko: '실시간 감시 시작', en: 'Start watching' })}
        />
      </div>

      <SettingsResourceCreateActionRow
        validationMessage={backupPathValidationMessage}
        canValidate={Boolean(newBackupSource.source_path.trim())}
        isValidating={isValidatingBackupPath}
        validateLabel={t({ ko: 'source 경로 검증', en: 'Validate source path' })}
        onValidate={onValidateBackupPath}
        canSubmit={Boolean(newBackupSource.source_path.trim() && newBackupSource.target_folder_name.trim())}
        isSubmitting={isAddingBackupSource}
        submitLabel={t({ ko: '백업 소스 추가', en: 'Add backup source' })}
        onSubmit={() => void onAddBackupSource()}
      />
    </div>
  )
}
