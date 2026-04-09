import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import { cn } from '@/lib/utils'
import { getWallpaperWidgetDefinition } from './wallpaper-widget-registry'
import type { WallpaperWidgetInstance } from './wallpaper-types'

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
  onRemoveWidget: (widgetId: string) => void
}

/** Render the editor inspector for one selected wallpaper widget. */
export function WallpaperWidgetInspector({ selectedWidget, groups, onPatchWidget, onRemoveWidget }: WallpaperWidgetInspectorProps) {
  if (!selectedWidget) {
    return (
      <div className={cn('rounded-sm border border-dashed border-border bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground')}>
        Select a widget.
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

  return (
    <>
      <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
        <div className="text-sm font-medium text-foreground">{getWallpaperWidgetDefinition(selectedWidget.type).title}</div>
        <SettingsField label="Title">
          <input
            className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
            value={selectedWidget.settings.title}
            onChange={(event) => {
              updateWidgetSettings({ title: event.target.value })
            }}
          />
        </SettingsField>

        {selectedWidget.type === 'clock' ? (
          <>
            <SettingsField label="Style">
              <Select
                value={selectedWidget.settings.visualStyle ?? 'minimal'}
                onChange={(event) => {
                  updateWidgetSettings({
                    visualStyle: event.target.value === 'glow' ? 'glow' : event.target.value === 'split' ? 'split' : 'minimal',
                  })
                }}
              >
                <option value="minimal">Minimal</option>
                <option value="glow">Glow</option>
                <option value="split">Split</option>
              </Select>
            </SettingsField>
            <SettingsField label="Time format">
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
              <span className="flex-1">Show seconds</span>
              <input
                type="checkbox"
                checked={selectedWidget.settings.showSeconds}
                onChange={(event) => {
                  updateWidgetSettings({ showSeconds: event.target.checked })
                }}
              />
            </SettingsToggleRow>
          </>
        ) : null}

        {selectedWidget.type === 'queue-status' ? (
          <>
            <SettingsField label="Refresh">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Visual">
              <Select
                value={selectedWidget.settings.visualMode ?? 'tiles'}
                onChange={(event) => {
                  updateWidgetSettings({
                    visualMode: event.target.value === 'bars' ? 'bars' : event.target.value === 'rings' ? 'rings' : 'tiles',
                  })
                }}
              >
                <option value="tiles">Tiles</option>
                <option value="bars">Bars</option>
                <option value="rings">Rings</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'recent-results' ? (
          <>
            <SettingsField label="Refresh">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Layout">
              <Select
                value={selectedWidget.settings.displayMode ?? 'grid'}
                onChange={(event) => {
                  updateWidgetSettings({ displayMode: event.target.value === 'stack' ? 'stack' : 'grid' })
                }}
              >
                <option value="grid">Grid</option>
                <option value="stack">Stack</option>
              </Select>
            </SettingsField>

            <SettingsField label="Visible count">
              <Select
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 3, 4, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Shift">
              <Select
                value={String(selectedWidget.settings.shiftIntervalSec ?? 8)}
                onChange={(event) => {
                  updateWidgetSettings({ shiftIntervalSec: Number(event.target.value) })
                }}
              >
                {[4, 6, 8, 12, 16].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'activity-pulse' ? (
          <>
            <SettingsField label="Refresh">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[3, 5, 10, 15, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Focus">
              <Select
                value={selectedWidget.settings.emphasis ?? 'mixed'}
                onChange={(event) => {
                  updateWidgetSettings({
                    emphasis: event.target.value === 'queue' ? 'queue' : event.target.value === 'results' ? 'results' : 'mixed',
                  })
                }}
              >
                <option value="mixed">Mixed</option>
                <option value="queue">Queue</option>
                <option value="results">Results</option>
              </Select>
            </SettingsField>

            <SettingsField label="Strength">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'image-showcase' ? (
          <>
            <SettingsField label="Playback">
              <Select
                value={selectedWidget.settings.playbackMode ?? 'carousel'}
                onChange={(event) => {
                  updateWidgetSettings({
                    playbackMode: event.target.value === 'static'
                      ? 'static'
                      : event.target.value === 'ken-burns'
                        ? 'ken-burns'
                        : 'carousel',
                  })
                }}
              >
                <option value="carousel">Carousel</option>
                <option value="ken-burns">Ken Burns</option>
                <option value="static">Static</option>
              </Select>
            </SettingsField>

            <SettingsField label="Interval">
              <Select
                value={String(selectedWidget.settings.slideshowIntervalSec ?? 20)}
                onChange={(event) => {
                  updateWidgetSettings({ slideshowIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 20, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Fit mode">
              <Select
                value={selectedWidget.settings.fitMode}
                onChange={(event) => {
                  updateWidgetSettings({ fitMode: event.target.value === 'contain' ? 'contain' : 'cover' })
                }}
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' || selectedWidget.type === 'floating-collage' ? (
          <SettingsField label="Group">
            <Select
              value={selectedWidget.settings.groupId !== null ? String(selectedWidget.settings.groupId) : ''}
              onChange={(event) => {
                const nextValue = event.target.value
                updateWidgetSettings({ groupId: nextValue ? Number(nextValue) : null })
              }}
            >
              <option value="">Select group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
              ))}
            </Select>
          </SettingsField>
        ) : null}

        {selectedWidget.type === 'group-image-view' ? (
          <>
            <SettingsField label="Visible count">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 4, 6, 9].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Motion">
              <Select
                value={selectedWidget.settings.motionMode ?? 'static'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionMode: event.target.value === 'pointer' ? 'pointer' : event.target.value === 'ambient' ? 'ambient' : 'static',
                  })
                }}
              >
                <option value="static">Static</option>
                <option value="ambient">Ambient</option>
                <option value="pointer">Reactive</option>
              </Select>
            </SettingsField>

            <SettingsField label="Strength">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'floating-collage' ? (
          <>
            <SettingsField label="Visible count">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="Strength">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'text-note' ? (
          <SettingsField label="Text">
            <textarea
              className="theme-settings-control min-h-24 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
              value={selectedWidget.settings.text}
              onChange={(event) => {
                updateWidgetSettings({ text: event.target.value })
              }}
            />
          </SettingsField>
        ) : null}

        {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' || selectedWidget.type === 'floating-collage' ? (
          <SettingsToggleRow>
            <span className="flex-1">Include children</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.includeChildren !== false}
              onChange={(event) => {
                updateWidgetSettings({ includeChildren: event.target.checked })
              }}
            />
          </SettingsToggleRow>
        ) : null}

        <SettingsToggleRow>
          <span className="flex-1">Show title</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showTitle !== false}
            onChange={(event) => {
              updateWidgetSettings({ showTitle: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">Show background</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showBackground !== false}
            onChange={(event) => {
              updateWidgetSettings({ showBackground: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">Hide widget</span>
          <input
            type="checkbox"
            checked={selectedWidget.hidden}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { hidden: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">Lock widget</span>
          <input
            type="checkbox"
            checked={selectedWidget.locked}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { locked: event.target.checked })
            }}
          />
        </SettingsToggleRow>
      </div>

      <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['X', selectedWidget.x],
            ['Y', selectedWidget.y],
            ['W', selectedWidget.w],
            ['H', selectedWidget.h],
          ].map(([label, value]) => (
            <SettingsValueTile key={String(label)} label={label} value={value} className="bg-background px-3 py-2" valueClassName="mt-1 text-sm font-medium" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '←', patch: { x: selectedWidget.x - 1 } },
            { label: '→', patch: { x: selectedWidget.x + 1 } },
            { label: '↑', patch: { y: selectedWidget.y - 1 } },
            { label: '↓', patch: { y: selectedWidget.y + 1 } },
            { label: 'W-', patch: { w: selectedWidget.w - 1 } },
            { label: 'W+', patch: { w: selectedWidget.w + 1 } },
            { label: 'H-', patch: { h: selectedWidget.h - 1 } },
            { label: 'H+', patch: { h: selectedWidget.h + 1 } },
          ].map(({ label, patch }) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              disabled={selectedWidget.locked}
              onClick={() => onPatchWidget(selectedWidget.id, patch)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <Button
        variant="destructive"
        className="w-full"
        onClick={() => {
          onRemoveWidget(selectedWidget.id)
        }}
      >
        <Trash2 className="h-4 w-4" />
        Remove widget
      </Button>
    </>
  )
}
