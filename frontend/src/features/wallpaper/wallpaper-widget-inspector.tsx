import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { cn } from '@/lib/utils'
import { getWallpaperWidgetDefinition } from './wallpaper-widget-registry'
import { WallpaperWidgetTypeEditorFields } from './wallpaper-widget-inspector-editors'
import { isWallpaperGroupSourceWidget, isWallpaperTextNoteWidget, type WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetInspectorPatch {
  x?: number
  y?: number
  w?: number
  h?: number
  zIndex?: number
  locked?: boolean
  hidden?: boolean
  settings?: WallpaperWidgetInstance['settings']
}

interface WallpaperWidgetInspectorProps {
  selectedWidget: WallpaperWidgetInstance | null
  groups: Array<{ id: number; name: string; depth?: number | null }>
  onPatchWidget: (widgetId: string, patch: WallpaperWidgetInspectorPatch) => void
}

/** Render the editor inspector for one selected wallpaper widget. */
export function WallpaperWidgetInspector({ selectedWidget, groups, onPatchWidget }: WallpaperWidgetInspectorProps) {
  if (!selectedWidget) {
    return (
      <div className={cn('rounded-sm border border-dashed border-border bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground')}>
        위젯을 선택해.
      </div>
    )
  }

  const updateWidgetSettings = (settingsPatch: Partial<WallpaperWidgetInstance['settings']>) => {
    onPatchWidget(selectedWidget.id, {
      settings: {
        ...selectedWidget.settings,
        ...settingsPatch,
      } as WallpaperWidgetInstance['settings'],
    })
  }

  const isGroupSourceWidget = isWallpaperGroupSourceWidget(selectedWidget)
  const hasBehaviorSection = !isWallpaperTextNoteWidget(selectedWidget)

  return (
    <>
      <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
        <div className="text-sm font-medium text-foreground">{getWallpaperWidgetDefinition(selectedWidget.type).title}</div>
        <div className="pt-1 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">기본</div>
        <SettingsField label="제목">
          <input
            className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
            value={selectedWidget.settings.title}
            onChange={(event) => {
              updateWidgetSettings({ title: event.target.value })
            }}
          />
        </SettingsField>

        {isGroupSourceWidget ? (
          <>
            <SettingsField label="그룹">
              <Select
                value={selectedWidget.settings.groupId !== null ? String(selectedWidget.settings.groupId) : ''}
                onChange={(event) => {
                  const nextValue = event.target.value
                  updateWidgetSettings({ groupId: nextValue ? Number(nextValue) : null })
                }}
              >
                <option value="">그룹 선택</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsToggleRow>
              <span className="flex-1">하위 그룹 포함</span>
              <input
                type="checkbox"
                checked={selectedWidget.settings.includeChildren !== false}
                onChange={(event) => {
                  updateWidgetSettings({ includeChildren: event.target.checked })
                }}
              />
            </SettingsToggleRow>
          </>
        ) : null}

        {hasBehaviorSection ? <div className="pt-1 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">동작</div> : null}
        <WallpaperWidgetTypeEditorFields selectedWidget={selectedWidget} updateWidgetSettings={updateWidgetSettings} />

        <div className="pt-1 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">표시</div>

        <SettingsToggleRow>
          <span className="flex-1">제목 표시</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showTitle === true}
            onChange={(event) => {
              updateWidgetSettings({ showTitle: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">배경 표시</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showBackground === true}
            onChange={(event) => {
              updateWidgetSettings({ showBackground: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">위젯 숨김</span>
          <input
            type="checkbox"
            checked={selectedWidget.hidden}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { hidden: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">위젯 잠금</span>
          <input
            type="checkbox"
            checked={selectedWidget.locked}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { locked: event.target.checked })
            }}
          />
        </SettingsToggleRow>
      </div>
    </>
  )
}
