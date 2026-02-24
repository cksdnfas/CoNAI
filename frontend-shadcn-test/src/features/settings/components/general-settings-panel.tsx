import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '@comfyui-image-manager/shared'
import type { GeneralSettings, MetadataExtractionSettings, ThumbnailSettings } from '@/services/settings-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  return (
    <Card>
      <CardHeader><CardTitle>{t('tabs.general')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.language} onChange={(e) => void onUpdate({ language: e.target.value as GeneralSettings['language'] }).then(() => i18n.changeLanguage(e.target.value))}>
          {SUPPORTED_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.name} ({lang.englishName})</option>)}
        </select>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.canvasCleanup.label')}<input type="checkbox" checked={settings.autoCleanupCanvasOnShutdown ?? false} onChange={(e) => void onUpdate({ autoCleanupCanvasOnShutdown: e.target.checked })} /></label>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.ratingBadges.label')}<input type="checkbox" checked={settings.showRatingBadges ?? true} onChange={(e) => void onUpdate({ showRatingBadges: e.target.checked })} /></label>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('general.deleteProtection.label')}<input type="checkbox" checked={settings.deleteProtection?.enabled ?? true} onChange={(e) => void onUpdate({ deleteProtection: { ...(settings.deleteProtection ?? { recycleBinPath: 'RecycleBin', enabled: true }), enabled: e.target.checked } })} /></label>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={thumbnailSettings.size} onChange={(e) => void onThumbnailUpdate({ size: e.target.value as ThumbnailSettings['size'] })}>
            <option value="original">{t('thumbnail.size.original')}</option><option value="2048">2048px</option><option value="1080">1080px</option><option value="720">720px</option><option value="512">512px</option>
          </select>
          <Input type="number" value={thumbnailSettings.quality} min={60} max={100} onChange={(e) => { const v = Number.parseInt(e.target.value, 10); if (!Number.isNaN(v)) void onThumbnailUpdate({ quality: v }) }} />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metadataSettings.stealthScanMode} onChange={(e) => void onMetadataUpdate({ stealthScanMode: e.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
            <option value="fast">{t('general.metadata.scanMode.fast.label')}</option><option value="full">{t('general.metadata.scanMode.full.label')}</option><option value="skip">{t('general.metadata.scanMode.skip.label')}</option>
          </select>
          <Input type="number" value={metadataSettings.stealthMaxFileSizeMB} min={1} step={0.5} onChange={(e) => { const v = Number.parseFloat(e.target.value); if (!Number.isNaN(v)) void onMetadataUpdate({ stealthMaxFileSizeMB: v }) }} />
        </div>
      </CardContent>
    </Card>
  )
}
