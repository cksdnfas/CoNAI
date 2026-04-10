import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { WallpaperImageWidgetEditorFields } from './wallpaper-widget-inspector-image-editor-fields'
import type { WallpaperWidgetSettingsPatchUpdater } from './wallpaper-widget-inspector-editor-shared'
import { WallpaperStatusWidgetEditorFields } from './wallpaper-widget-inspector-status-editor-fields'
import type { WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetTypeEditorFieldsProps {
  selectedWidget: WallpaperWidgetInstance
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}

/** Render widget-specific editor fields while keeping the main inspector focused on shared controls. */
export function WallpaperWidgetTypeEditorFields({ selectedWidget, updateWidgetSettings }: WallpaperWidgetTypeEditorFieldsProps) {
  switch (selectedWidget.type) {
    case 'clock':
      return (
        <>
          <SettingsField label="스타일">
            <Select
              value={selectedWidget.settings.visualStyle ?? 'minimal'}
              onChange={(event) => {
                updateWidgetSettings({
                  visualStyle: event.target.value === 'glow' ? 'glow' : event.target.value === 'split' ? 'split' : 'minimal',
                })
              }}
            >
              <option value="minimal">미니멀</option>
              <option value="glow">글로우</option>
              <option value="split">분할</option>
            </Select>
          </SettingsField>
          <SettingsField label="시간 형식">
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
            <span className="flex-1">초 표시</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.showSeconds}
              onChange={(event) => {
                updateWidgetSettings({ showSeconds: event.target.checked })
              }}
            />
          </SettingsToggleRow>
        </>
      )

    case 'text-note':
      return (
        <SettingsField label="내용">
          <textarea
            className="theme-settings-control min-h-24 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
            value={selectedWidget.settings.text}
            onChange={(event) => {
              updateWidgetSettings({ text: event.target.value })
            }}
          />
        </SettingsField>
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
