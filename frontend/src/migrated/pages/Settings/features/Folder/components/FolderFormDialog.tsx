import React, { useEffect, useState } from 'react'
import { CircleHelp, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { folderApi } from '../../../../../services/folderApi'
import type { WatchedFolder, WatchedFolderCreate, WatchedFolderUpdate } from '../../../../../types/folder'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  folder?: WatchedFolder | null
}

const FolderFormDialog: React.FC<Props> = ({ open, onClose, folder, onSuccess }) => {
  const { t } = useTranslation('settings')
  const isEdit = Boolean(folder)

  const [formData, setFormData] = useState<WatchedFolderCreate>({
    folder_path: '',
    folder_name: '',
    auto_scan: true,
    scan_interval: 60,
    recursive: true,
    exclude_extensions: [],
    exclude_patterns: [],
    watcher_enabled: true,
    watcher_polling_interval: null,
  })

  const [newExtension, setNewExtension] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (folder) {
      setFormData({
        folder_path: folder.folder_path,
        folder_name: folder.folder_name || '',
        auto_scan: folder.auto_scan === 1,
        scan_interval: folder.scan_interval,
        recursive: folder.recursive === 1,
        exclude_extensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
        exclude_patterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : [],
        watcher_enabled: folder.watcher_enabled === 1,
        watcher_polling_interval: folder.watcher_polling_interval,
      })
    } else {
      setFormData({
        folder_path: '',
        folder_name: '',
        auto_scan: true,
        scan_interval: 60,
        recursive: true,
        exclude_extensions: [],
        exclude_patterns: [],
        watcher_enabled: true,
        watcher_polling_interval: null,
      })
    }
    setError(null)
  }, [folder])

  const handleAddExtension = () => {
    if (!newExtension.trim()) return
    const extension = newExtension.trim().startsWith('.') ? newExtension.trim() : `.${newExtension.trim()}`
    if (!formData.exclude_extensions?.includes(extension)) {
      setFormData({
        ...formData,
        exclude_extensions: [...(formData.exclude_extensions || []), extension],
      })
    }
    setNewExtension('')
  }

  const handleRemoveExtension = (extension: string) => {
    setFormData({
      ...formData,
      exclude_extensions: formData.exclude_extensions?.filter((item) => item !== extension),
    })
  }

  const handleAddPattern = () => {
    if (!newPattern.trim()) return
    const pattern = newPattern.trim()
    if (!formData.exclude_patterns?.includes(pattern)) {
      setFormData({
        ...formData,
        exclude_patterns: [...(formData.exclude_patterns || []), pattern],
      })
    }
    setNewPattern('')
  }

  const handleRemovePattern = (pattern: string) => {
    setFormData({
      ...formData,
      exclude_patterns: formData.exclude_patterns?.filter((item) => item !== pattern),
    })
  }

  const handleSave = async () => {
    if (!formData.folder_path.trim()) {
      setError(t('folderSettings.dialog.errorPath'))
      return
    }

    setSaving(true)
    try {
      setError(null)
      if (isEdit && folder) {
        const updates: WatchedFolderUpdate = {
          folder_name: formData.folder_name,
          auto_scan: formData.auto_scan,
          scan_interval: formData.scan_interval,
          recursive: formData.recursive,
          exclude_extensions: formData.exclude_extensions,
          exclude_patterns: formData.exclude_patterns,
          watcher_enabled: formData.watcher_enabled,
          watcher_polling_interval: formData.watcher_polling_interval,
        }
        await folderApi.updateFolder(folder.id, updates)
      } else {
        await folderApi.addFolder(formData)
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
      onSuccess()
      onClose()
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('folderSettings.dialog.errorSave'))
          : t('folderSettings.dialog.errorSave')
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('folderSettings.dialog.editTitle') : t('folderSettings.dialog.addTitle')}</DialogTitle>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="folder-path" className="text-sm font-medium">{t('folderSettings.dialog.folderPath')}</label>
            <Input
              id="folder-path"
              value={formData.folder_path}
              onChange={(event) => setFormData({ ...formData, folder_path: event.target.value })}
              disabled={isEdit}
            />
            <p className="text-muted-foreground text-xs">
              {isEdit ? t('folderSettings.dialog.folderPathDisabled') : t('folderSettings.dialog.folderPathHelper')}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="folder-name" className="text-sm font-medium">{t('folderSettings.dialog.folderName')}</label>
            <Input
              id="folder-name"
              value={formData.folder_name}
              onChange={(event) => setFormData({ ...formData, folder_name: event.target.value })}
            />
            <p className="text-muted-foreground text-xs">{t('folderSettings.dialog.folderNameHelper')}</p>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={formData.watcher_enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, watcher_enabled: checked })}
            />
            <span className="text-sm">{t('folderSettings.dialog.watcherEnabled')}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('folderSettings.dialog.watcherTooltip')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {formData.watcher_enabled ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium">
                <span>{t('folderSettings.dialog.pollingInterval')}</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground">
                        <CircleHelp className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('folderSettings.dialog.pollingIntervalTooltip')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                type="number"
                value={formData.watcher_polling_interval ?? ''}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    watcher_polling_interval:
                      event.target.value === '' ? null : Number.parseInt(event.target.value, 10) || null,
                  })
                }
                placeholder={t('folderSettings.dialog.pollingIntervalPlaceholder')}
                min={100}
                step={100}
              />
              <p className="text-muted-foreground text-xs">{t('folderSettings.dialog.pollingIntervalHelper')}</p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Switch
              checked={formData.auto_scan}
              onCheckedChange={(checked) => setFormData({ ...formData, auto_scan: checked })}
            />
            <span className="text-sm">{t('folderSettings.dialog.autoScan')}</span>
          </div>

          {formData.auto_scan ? (
            <div className="space-y-1">
              <label htmlFor="scan-interval" className="text-sm font-medium">{t('folderSettings.dialog.scanInterval')}</label>
              <Input
                id="scan-interval"
                type="number"
                value={formData.scan_interval}
                onChange={(event) =>
                  setFormData({ ...formData, scan_interval: Number.parseInt(event.target.value, 10) || 60 })
                }
              />
              <p className="text-muted-foreground text-xs">{t('folderSettings.dialog.scanIntervalHelper')}</p>
            </div>
          ) : null}

          <button
            type="button"
            className="text-muted-foreground text-left text-sm hover:underline"
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            {t('folderSettings.dialog.advancedOptions')}
          </button>

          {showAdvanced ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.recursive}
                  onCheckedChange={(checked) => setFormData({ ...formData, recursive: checked })}
                />
                <span className="text-sm">{t('folderSettings.dialog.recursive')}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <span>{t('folderSettings.dialog.excludeExtensions')}</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground">
                          <CircleHelp className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('folderSettings.dialog.excludeExtensionsTooltip')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newExtension}
                    onChange={(event) => setNewExtension(event.target.value)}
                    onKeyDown={(event) => (event.key === 'Enter' ? handleAddExtension() : undefined)}
                    placeholder={t('folderSettings.dialog.excludeExtensionsPlaceholder')}
                  />
                  <Button type="button" variant="outline" onClick={handleAddExtension}>
                    {t('folderSettings.dialog.addButton')}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(formData.exclude_extensions || []).map((extension) => (
                    <Badge key={extension} className="cursor-pointer" onClick={() => handleRemoveExtension(extension)}>
                      {extension}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <span>{t('folderSettings.dialog.excludePatterns')}</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground">
                          <CircleHelp className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('folderSettings.dialog.excludePatternsTooltip')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newPattern}
                    onChange={(event) => setNewPattern(event.target.value)}
                    onKeyDown={(event) => (event.key === 'Enter' ? handleAddPattern() : undefined)}
                    placeholder={t('folderSettings.dialog.excludePatternsPlaceholder')}
                  />
                  <Button type="button" variant="outline" onClick={handleAddPattern}>
                    {t('folderSettings.dialog.addButton')}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(formData.exclude_patterns || []).map((pattern) => (
                    <Badge key={pattern} className="cursor-pointer" onClick={() => handleRemovePattern(pattern)}>
                      {pattern}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('folderSettings.dialog.cancelButton')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('folderSettings.dialog.savingButton') : t('folderSettings.dialog.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FolderFormDialog
