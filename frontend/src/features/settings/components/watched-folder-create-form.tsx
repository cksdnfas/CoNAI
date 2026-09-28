import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { SettingsResourceCreateActionRow } from './settings-resource-shared'
import type { NewWatchedFolderDraft } from '../settings-utils'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'

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
  const { t } = useI18n()

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t({ ko: '폴더 경로', en: 'Folder path' })}>
          <Input variant="settings" value={newFolder.folder_path} onChange={(event) => onNewFolderChange({ folder_path: event.target.value })} placeholder="D:\\Images\\Incoming" />
        </Field>

        <Field label={t({ ko: '표시 이름', en: 'Display name' })}>
          <Input variant="settings" value={newFolder.folder_name} onChange={(event) => onNewFolderChange({ folder_name: event.target.value })} placeholder={t({ ko: 'Incoming', en: 'Incoming' })} />
        </Field>

        <Field label={t({ ko: '스캔 주기(분)', en: 'Scan interval (minutes)' })}>
          <NumberStepperInput min={1} variant="settings" value={newFolder.scan_interval} onValueCommit={(nextValue) => onNewFolderChange({ scan_interval: Number(nextValue) || 1 })} />
        </Field>

        <Field label={t({ ko: '폴링 주기(ms)', en: 'Polling interval (ms)' })} hint={t({ ko: '비워두면 자동 (권장)', en: 'Empty = auto (recommended)' })}>
          <NumberStepperInput min={2000} allowEmpty variant="settings" value={newFolder.watcher_polling_interval} onValueCommit={(nextValue) => onNewFolderChange({ watcher_polling_interval: nextValue === '' ? null : Number(nextValue) || null })} placeholder={t({ ko: '자동 감지', en: 'Auto detect' })} disabled={!newFolder.watcher_enabled} />
        </Field>

        <Field label={t({ ko: '제외 확장자', en: 'Excluded extensions' })}>
          <Input variant="settings" value={newFolder.exclude_extensions} onChange={(event) => onNewFolderChange({ exclude_extensions: event.target.value })} placeholder="tmp, db" />
        </Field>

        <Field label={t({ ko: '제외 패턴', en: 'Excluded patterns' })}>
          <Input variant="settings" value={newFolder.exclude_patterns} onChange={(event) => onNewFolderChange({ exclude_patterns: event.target.value })} placeholder="@eaDir, cache" />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SettingsSwitchRow
          checked={newFolder.auto_scan}
          onCheckedChange={(checked) => onNewFolderChange({ auto_scan: checked })}
          label={t({ ko: '자동 스캔', en: 'Auto scan' })}
        />
        <SettingsSwitchRow
          checked={newFolder.recursive}
          onCheckedChange={(checked) => onNewFolderChange({ recursive: checked })}
          label={t({ ko: '하위 폴더 포함', en: 'Include subfolders' })}
        />
        <SettingsSwitchRow
          checked={newFolder.watcher_enabled}
          onCheckedChange={(checked) => onNewFolderChange({ watcher_enabled: checked })}
          label={t({ ko: '실시간 감시 시작', en: 'Start watching' })}
        />
      </div>

      <SettingsResourceCreateActionRow
        validationMessage={pathValidationMessage}
        canValidate={Boolean(newFolder.folder_path.trim())}
        isValidating={isValidatingPath}
        validateLabel={t({ ko: '경로 검증', en: 'Validate path' })}
        onValidate={onValidatePath}
        canSubmit={Boolean(newFolder.folder_path.trim())}
        isSubmitting={isAddingFolder}
        submitLabel={t({ ko: '감시 폴더 추가', en: 'Add watched folder' })}
        onSubmit={() => void onAddFolder()}
      />
    </div>
  )
}
