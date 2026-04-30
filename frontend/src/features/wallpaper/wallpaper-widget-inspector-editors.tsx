import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import {
  WallpaperInspectorSectionCard,
  type WallpaperWidgetSettingsPatchUpdater,
} from './wallpaper-widget-inspector-editor-shared'
import { WallpaperImageWidgetEditorFields } from './wallpaper-widget-inspector-image-editor-fields'
import { WallpaperStatusWidgetEditorFields } from './wallpaper-widget-inspector-status-editor-fields'
import { useI18n } from '@/i18n'
import type { WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetTypeEditorFieldsProps {
  selectedWidget: WallpaperWidgetInstance
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}

/** Render widget-specific editor fields while keeping the main inspector focused on shared controls. */
export function WallpaperWidgetTypeEditorFields({ selectedWidget, updateWidgetSettings }: WallpaperWidgetTypeEditorFieldsProps) {
  const { t } = useI18n()

  switch (selectedWidget.type) {
    case 'clock':
      return (
        <WallpaperInspectorSectionCard title={t({ ko: '시계', en: 'Clock' })}>
          <SettingsField label={t({ ko: '스타일', en: 'Style' })}>
            <Select
              value={selectedWidget.settings.visualStyle ?? 'minimal'}
              onChange={(event) => {
                updateWidgetSettings({
                  visualStyle: event.target.value === 'glow' ? 'glow' : event.target.value === 'split' ? 'split' : 'minimal',
                })
              }}
            >
              <option value="minimal">{t({ ko: '미니멀', en: 'Minimal' })}</option>
              <option value="glow">{t({ ko: '글로우', en: 'Glow' })}</option>
              <option value="split">{t({ ko: '분할', en: 'Split' })}</option>
            </Select>
          </SettingsField>
          <SettingsField label={t({ ko: '시간 형식', en: 'Time format' })}>
            <Select
              value={selectedWidget.settings.timeFormat}
              onChange={(event) => {
                updateWidgetSettings({
                  timeFormat: event.target.value === '12h' ? '12h' : '24h',
                })
              }}
            >
              <option value="24h">24h</option>
              <option value="12h">12h</option>
            </Select>
          </SettingsField>
          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '초 표시', en: 'Show seconds' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.showSeconds}
              onChange={(event) => {
                updateWidgetSettings({ showSeconds: event.target.checked })
              }}
            />
          </SettingsToggleRow>
        </WallpaperInspectorSectionCard>
      )

    case 'text-note':
      return (
        <WallpaperInspectorSectionCard title={t({ ko: '내용', en: 'Content' })}>
          <SettingsField label={t({ ko: '내용', en: 'Content' })}>
            <Textarea
              variant="settings"
              rows={4}
              value={selectedWidget.settings.text}
              onChange={(event) => {
                updateWidgetSettings({ text: event.target.value })
              }}
            />
          </SettingsField>
        </WallpaperInspectorSectionCard>
      )

    case 'queue-status':
    case 'recent-results':
    case 'activity-pulse':
      return <WallpaperStatusWidgetEditorFields selectedWidget={selectedWidget} updateWidgetSettings={updateWidgetSettings} />

    case 'group-image-view':
    case 'image-showcase':
    case 'floating-collage':
      return <WallpaperImageWidgetEditorFields selectedWidget={selectedWidget} updateWidgetSettings={updateWidgetSettings} />

    default:
      return null
  }
}
