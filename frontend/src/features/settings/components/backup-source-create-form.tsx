import { CircleHelp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow } from './settings-primitives'
import { SettingsResourceCreateActionRow } from './settings-resource-shared'
import { buildBackupTargetPreviewPath, type NewBackupSourceDraft } from '../settings-utils'
import { useI18n } from '@/i18n'

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
        <SettingsField label={t({ ko: 'source 폴더 경로', en: 'Source folder path' })}>
          <Input variant="settings" value={newBackupSource.source_path} onChange={(event) => onNewBackupSourceChange({ source_path: event.target.value })} placeholder="D:\\Images\\Incoming" />
        </SettingsField>

        <SettingsField label={t({ ko: '표시 이름', en: 'Display name' })}>
          <Input variant="settings" value={newBackupSource.display_name} onChange={(event) => onNewBackupSourceChange({ display_name: event.target.value })} placeholder={t({ ko: 'Backup source A', en: 'Backup source A' })} />
        </SettingsField>

        <SettingsField
          label={(
            <span className="inline-flex items-center gap-1">
              {t({ ko: 'Upload 내부 대상 경로', en: 'Target path inside Upload' })}
              <span
                className="inline-flex cursor-help text-muted-foreground"
                title={[
                  t({ ko: '업로드 폴더 안의 상대 경로로 지정해.', en: 'Use a relative path inside the upload folder.' }),
                  t({ ko: '예: Backup → Upload/Backup', en: 'Example: Backup → Upload/Backup' }),
                  t({ ko: '예: Backup/001 → Upload/Backup/001', en: 'Example: Backup/001 → Upload/Backup/001' }),
                  t({ ko: '앞에 / 를 붙여도 자동으로 Upload 기준으로 정리돼.', en: 'A leading / is normalized relative to Upload automatically.' }),
                ].join('\n')}
                aria-label={t({ ko: '업로드 폴더 안의 상대 경로로 지정해. 예: Backup이면 Upload/Backup, Backup/001이면 Upload/Backup/001에 저장돼.', en: 'Use a relative path inside the upload folder. For example, Backup saves to Upload/Backup, and Backup/001 saves to Upload/Backup/001.' })}
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </span>
            </span>
          )}
        >
          <Input
            variant="settings"
            value={newBackupSource.target_folder_name}
            onChange={(event) => onNewBackupSourceChange({ target_folder_name: event.target.value })}
            placeholder={t({ ko: 'Backup 또는 Backup/001', en: 'Backup or Backup/001' })}
          />
          <p className="mt-2 break-all font-mono text-xs text-primary">{t({ ko: '최종 경로: {path}', en: 'Final path: {path}' }, { path: buildBackupTargetPreviewPath(newBackupSource.target_folder_name) })}</p>
        </SettingsField>

        <SettingsField label={t({ ko: '가져오기 모드', en: 'Import mode' })}>
          <Select variant="settings" value={newBackupSource.import_mode} onChange={(event) => onNewBackupSourceChange({ import_mode: event.target.value as NewBackupSourceDraft['import_mode'] })}>
            <option value="copy_original">{t({ ko: '원본 복사', en: 'Copy original' })}</option>
            <option value="convert_webp">{t({ ko: 'WebP 변환 (메타 보존)', en: 'Convert to WebP (preserve metadata)' })}</option>
          </Select>
        </SettingsField>

        <SettingsField label={t({ ko: 'watcher polling(ms)', en: 'Watcher polling (ms)' })}>
          <Input type="number" min={100} variant="settings" value={newBackupSource.watcher_polling_interval} onChange={(event) => onNewBackupSourceChange({ watcher_polling_interval: Number(event.target.value) || 100 })} />
        </SettingsField>

        <SettingsField label={t({ ko: 'WebP 품질', en: 'WebP quality' })}>
          <Input type="number" min={1} max={100} variant="settings" value={newBackupSource.webp_quality} onChange={(event) => onNewBackupSourceChange({ webp_quality: Number(event.target.value) || 90 })} disabled={newBackupSource.import_mode !== 'convert_webp'} />
        </SettingsField>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsToggleRow>
          <input type="checkbox" checked={newBackupSource.recursive} onChange={(event) => onNewBackupSourceChange({ recursive: event.target.checked })} />
          {t({ ko: '하위 폴더 포함', en: 'Include subfolders' })}
        </SettingsToggleRow>
        <SettingsToggleRow>
          <input type="checkbox" checked={newBackupSource.watcher_enabled} onChange={(event) => onNewBackupSourceChange({ watcher_enabled: event.target.checked })} />
          {t({ ko: 'watcher 시작', en: 'Start watcher' })}
        </SettingsToggleRow>
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
