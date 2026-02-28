import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '@comfyui-image-manager/shared'
import type { GeneralSettings, MetadataExtractionSettings, ThumbnailSettings } from '@/services/settings-api'
import { settingsApi } from '@/services/settings-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface GeneralSettingsPanelProps {
  settings: GeneralSettings
  metadataSettings: MetadataExtractionSettings
  thumbnailSettings: ThumbnailSettings
  onUpdate: (settings: Partial<GeneralSettings>) => Promise<void>
  onMetadataUpdate: (settings: Partial<MetadataExtractionSettings>) => Promise<void>
  onThumbnailUpdate: (settings: Partial<ThumbnailSettings>) => Promise<void>
}

export function GeneralSettingsPanel({ settings, metadataSettings, thumbnailSettings, onUpdate, onMetadataUpdate, onThumbnailUpdate }: GeneralSettingsPanelProps) {
  const { t, i18n } = useTranslation('settings')

  const handleThumbnailRegeneration = async () => {
    const confirmed = window.confirm(t('thumbnail.regenerate.description'))
    if (!confirmed) {
      return
    }

    try {
      await settingsApi.thumbnailRegeneration.regenerate()
    } catch (error) {
      console.error('Failed to regenerate thumbnails:', error)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t('tabs.general')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('general.language.label')}</p>
        <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.language} onChange={(e) => void onUpdate({ language: e.target.value as GeneralSettings['language'] }).then(() => i18n.changeLanguage(e.target.value))}>
          {SUPPORTED_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.name} ({lang.englishName})</option>)}
        </select>
        </div>

        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.canvasCleanup.label')}<input type="checkbox" checked={settings.autoCleanupCanvasOnShutdown ?? false} onChange={(e) => void onUpdate({ autoCleanupCanvasOnShutdown: e.target.checked })} /></label>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.ratingBadges.label')}<input type="checkbox" checked={settings.showRatingBadges ?? true} onChange={(e) => void onUpdate({ showRatingBadges: e.target.checked })} /></label>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.deleteProtection.label')}<input type="checkbox" checked={settings.deleteProtection?.enabled ?? true} onChange={(e) => void onUpdate({ deleteProtection: { ...(settings.deleteProtection ?? { recycleBinPath: 'RecycleBin', enabled: true }), enabled: e.target.checked } })} /></label>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t('thumbnail.title')}</p>
        <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('thumbnail.size.label')}</p>
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={thumbnailSettings.size} onChange={(e) => void onThumbnailUpdate({ size: e.target.value as ThumbnailSettings['size'] })}>
            <option value="original">{t('thumbnail.size.original')}</option><option value="2048">2048px</option><option value="1080">1080px</option><option value="720">720px</option><option value="512">512px</option>
          </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('thumbnail.quality.label')}</p>
          <Input type="number" value={thumbnailSettings.quality} min={60} max={100} onChange={(e) => { const v = Number.parseInt(e.target.value, 10); if (!Number.isNaN(v)) void onThumbnailUpdate({ quality: v }) }} />
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={() => void handleThumbnailRegeneration()}>
            {t('thumbnail.regenerate.button')}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t('general.metadata.title')}</p>
        <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('general.metadata.scanMode.title')}</p>
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metadataSettings.stealthScanMode} onChange={(e) => void onMetadataUpdate({ stealthScanMode: e.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
            <option value="fast">{t('general.metadata.scanMode.fast.label')}</option><option value="full">{t('general.metadata.scanMode.full.label')}</option><option value="skip">{t('general.metadata.scanMode.skip.label')}</option>
          </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('general.metadata.limits.fileSize.label')}</p>
          <Input type="number" value={metadataSettings.stealthMaxFileSizeMB} min={1} step={0.5} onChange={(e) => { const v = Number.parseFloat(e.target.value); if (!Number.isNaN(v)) void onMetadataUpdate({ stealthMaxFileSizeMB: v }) }} />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('general.metadata.limits.resolution.label')}</p>
            <Input type="number" value={metadataSettings.stealthMaxResolutionMP} min={1} step={0.5} onChange={(e) => { const v = Number.parseFloat(e.target.value); if (!Number.isNaN(v)) void onMetadataUpdate({ stealthMaxResolutionMP: v }) }} />
          </div>

          <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.metadata.skipSettings.comfyui.label')}<input type="checkbox" checked={metadataSettings.skipStealthForComfyUI} onChange={(e) => void onMetadataUpdate({ skipStealthForComfyUI: e.target.checked })} /></label>
          <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.metadata.skipSettings.webui.label')}<input type="checkbox" checked={metadataSettings.skipStealthForWebUI} onChange={(e) => void onMetadataUpdate({ skipStealthForWebUI: e.target.checked })} /></label>
          <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.metadata.secondary.label')}<input type="checkbox" checked={metadataSettings.enableSecondaryExtraction} onChange={(e) => void onMetadataUpdate({ enableSecondaryExtraction: e.target.checked })} /></label>
        </div>
      </CardContent>
    </Card>
  )
}
