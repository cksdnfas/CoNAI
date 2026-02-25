import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaggerSettings } from '@/services/settings-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface TaggerSettingsPanelProps {
  settings: TaggerSettings
  onUpdate: (settings: Partial<TaggerSettings>) => Promise<void>
}

export function TaggerSettingsPanel({ settings, onUpdate }: TaggerSettingsPanelProps) {
  const { t } = useTranslation('settings')
  const [local, setLocal] = useState(settings)

  useEffect(() => {
    setLocal(settings)
  }, [settings])

  return (
    <Card>
      <CardHeader><CardTitle>{t('tabs.tagger')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('tagger.enabled')}<input type="checkbox" checked={local.enabled} onChange={(e) => setLocal((prev) => ({ ...prev, enabled: e.target.checked }))} /></label>
        <label className="flex items-center justify-between rounded-md border p-2 text-sm">{t('tagger.autoTagOnUpload')}<input type="checkbox" checked={local.autoTagOnUpload} onChange={(e) => setLocal((prev) => ({ ...prev, autoTagOnUpload: e.target.checked }))} /></label>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={local.model} onChange={(e) => setLocal((prev) => ({ ...prev, model: e.target.value as TaggerSettings['model'] }))}>
            <option value="vit">ViT</option><option value="swinv2">SwinV2</option><option value="convnext">ConvNext</option>
          </select>
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={local.device} onChange={(e) => setLocal((prev) => ({ ...prev, device: e.target.value as TaggerSettings['device'] }))}>
            <option value="auto">Auto</option><option value="cpu">CPU</option><option value="cuda">CUDA</option>
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input type="number" min={0} max={1} step={0.01} value={local.generalThreshold} onChange={(e) => { const v = Number.parseFloat(e.target.value); if (!Number.isNaN(v)) setLocal((prev) => ({ ...prev, generalThreshold: v })) }} />
          <Input type="number" min={0} max={1} step={0.01} value={local.characterThreshold} onChange={(e) => { const v = Number.parseFloat(e.target.value); if (!Number.isNaN(v)) setLocal((prev) => ({ ...prev, characterThreshold: v })) }} />
        </div>
        <Input value={local.pythonPath} onChange={(e) => setLocal((prev) => ({ ...prev, pythonPath: e.target.value }))} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setLocal(settings)}>{t('tagger.buttons.cancel')}</Button>
          <Button type="button" onClick={() => void onUpdate(local)}>{t('tagger.buttons.save')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
