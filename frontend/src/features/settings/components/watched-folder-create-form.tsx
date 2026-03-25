import { FolderPlus, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow } from './settings-primitives'
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
          <input
            value={newFolder.folder_path}
            onChange={(event) => onNewFolderChange({ folder_path: event.target.value })}
            placeholder="D:\\Images\\Incoming"
            className={settingsControlClassName}
          />
        </SettingsField>

        <SettingsField label="표시 이름">
          <input
            value={newFolder.folder_name}
            onChange={(event) => onNewFolderChange({ folder_name: event.target.value })}
            placeholder="Incoming"
            className={settingsControlClassName}
          />
        </SettingsField>

        <SettingsField label="스캔 주기(분)">
          <input
            type="number"
            min={1}
            value={newFolder.scan_interval}
            onChange={(event) => onNewFolderChange({ scan_interval: Number(event.target.value) || 1 })}
            className={settingsControlClassName}
          />
        </SettingsField>

        <SettingsField label="watcher polling(ms)">
          <input
            type="number"
            min={100}
            value={newFolder.watcher_polling_interval}
            onChange={(event) => onNewFolderChange({ watcher_polling_interval: Number(event.target.value) || 100 })}
            className={settingsControlClassName}
          />
        </SettingsField>

        <SettingsField label="제외 확장자">
          <input
            value={newFolder.exclude_extensions}
            onChange={(event) => onNewFolderChange({ exclude_extensions: event.target.value })}
            placeholder="tmp, db"
            className={settingsControlClassName}
          />
        </SettingsField>

        <SettingsField label="제외 패턴">
          <input
            value={newFolder.exclude_patterns}
            onChange={(event) => onNewFolderChange({ exclude_patterns: event.target.value })}
            placeholder="@eaDir, cache"
            className={settingsControlClassName}
          />
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

      {pathValidationMessage ? <p className="text-sm text-primary">{pathValidationMessage}</p> : null}

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={isValidatingPath || !newFolder.folder_path.trim()} onClick={onValidatePath}>
          {isValidatingPath ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          경로 검증
        </Button>

        <Button type="button" size="sm" disabled={isAddingFolder || !newFolder.folder_path.trim()} onClick={() => void onAddFolder()}>
          {isAddingFolder ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          감시 폴더 추가
        </Button>
      </div>
    </div>
  )
}
