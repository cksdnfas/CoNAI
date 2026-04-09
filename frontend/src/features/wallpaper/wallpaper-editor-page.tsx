import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import { getGroupsHierarchyAll } from '@/lib/api'
import { getAppSettings, updateAppearanceSettings } from '@/lib/api-settings'
import { cn } from '@/lib/utils'
import { getWallpaperCanvasPreset, listWallpaperCanvasPresets } from './wallpaper-canvas-presets'
import {
  appendWallpaperWidget,
  buildWallpaperStarterLayout,
  clampWallpaperWidgetInstance,
  cloneWallpaperPresetToDraft,
  deleteWallpaperLayoutPreset,
  loadWallpaperActivePresetId,
  loadWallpaperLayoutDraft,
  loadWallpaperLayoutPresets,
  normalizeWallpaperLayoutPreset,
  saveWallpaperActivePresetId,
  saveWallpaperLayoutDraft,
  saveWallpaperLayoutPresets,
  upsertWallpaperLayoutPreset,
} from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'
import { getWallpaperWidgetDefinition, listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import type { WallpaperLayoutPreset, WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetInstancePatch {
  x?: number
  y?: number
  w?: number
  h?: number
  zIndex?: number
  locked?: boolean
  hidden?: boolean
  settings?: WallpaperWidgetInstance['settings']
}

/** Update one selected widget with a frame patch while keeping it inside the grid. */
function patchSelectedWidget(layoutPreset: WallpaperLayoutPreset, widgetId: string | null, patch: WallpaperWidgetInstancePatch) {
  if (!widgetId) {
    return layoutPreset
  }

  const canvasPreset = getWallpaperCanvasPreset(layoutPreset.canvasPresetId)
  return normalizeWallpaperLayoutPreset(
    {
      ...layoutPreset,
      widgets: layoutPreset.widgets.map((widget) => (
        widget.id === widgetId ? clampWallpaperWidgetInstance({ ...widget, ...patch } as WallpaperWidgetInstance, canvasPreset) : widget
      )),
    },
    canvasPreset,
  )
}

/** Remove one selected widget from the layout draft. */
function removeSelectedWidget(layoutPreset: WallpaperLayoutPreset, widgetId: string | null) {
  if (!widgetId) {
    return layoutPreset
  }

  return normalizeWallpaperLayoutPreset({
    ...layoutPreset,
    widgets: layoutPreset.widgets.filter((widget) => widget.id !== widgetId),
  })
}

export function WallpaperEditorPage() {
  const { showSnackbar } = useSnackbar()
  const hasHydratedServerPresetsRef = useRef(false)
  const [layoutPreset, setLayoutPreset] = useState(() => loadWallpaperLayoutDraft() ?? buildWallpaperStarterLayout('landscape-1080p'))
  const [savedPresets, setSavedPresets] = useState(() => loadWallpaperLayoutPresets())
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadWallpaperActivePresetId())
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)

  const notifyInfo = (message: string) => showSnackbar({ message, tone: 'info' })
  const notifyError = (message: string) => showSnackbar({ message, tone: 'error' })

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'wallpaper-widget-editor'],
    queryFn: () => getGroupsHierarchyAll(),
    staleTime: 60_000,
  })

  const wallpaperSettingsQuery = useQuery({
    queryKey: ['app-settings', 'wallpaper-layout'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })

  const wallpaperPresetMutation = useMutation({
    mutationFn: ({ wallpaperLayoutPresets, wallpaperActivePresetId }: { wallpaperLayoutPresets: WallpaperLayoutPreset[]; wallpaperActivePresetId: string | null }) => (
      updateAppearanceSettings({ wallpaperLayoutPresets, wallpaperActivePresetId })
    ),
  })

  const canvasPreset = useMemo(() => getWallpaperCanvasPreset(layoutPreset.canvasPresetId), [layoutPreset.canvasPresetId])
  const effectiveActivePresetId = useMemo(
    () => (activePresetId && savedPresets.some((preset) => preset.id === activePresetId) ? activePresetId : null),
    [activePresetId, savedPresets],
  )
  const activePreset = useMemo(
    () => savedPresets.find((preset) => preset.id === effectiveActivePresetId) ?? null,
    [effectiveActivePresetId, savedPresets],
  )
  const effectiveSelectedWidgetId = useMemo(
    () => (selectedWidgetId && layoutPreset.widgets.some((widget) => widget.id === selectedWidgetId) ? selectedWidgetId : (layoutPreset.widgets[0]?.id ?? null)),
    [layoutPreset.widgets, selectedWidgetId],
  )
  const selectedWidget = useMemo(
    () => layoutPreset.widgets.find((widget) => widget.id === effectiveSelectedWidgetId) ?? null,
    [effectiveSelectedWidgetId, layoutPreset.widgets],
  )

  useEffect(() => {
    saveWallpaperLayoutDraft(layoutPreset)
  }, [layoutPreset])

  useEffect(() => {
    saveWallpaperLayoutPresets(savedPresets)
  }, [savedPresets])

  useEffect(() => {
    saveWallpaperActivePresetId(effectiveActivePresetId)
  }, [effectiveActivePresetId])

  useEffect(() => {
    if (hasHydratedServerPresetsRef.current || !wallpaperSettingsQuery.data) {
      return
    }

    hasHydratedServerPresetsRef.current = true
    const serverPresets = wallpaperSettingsQuery.data.appearance.wallpaperLayoutPresets
    const serverActivePresetId = wallpaperSettingsQuery.data.appearance.wallpaperActivePresetId

    if (serverPresets.length === 0 && serverActivePresetId === null) {
      return
    }

    queueMicrotask(() => {
      setSavedPresets(serverPresets)
      setActivePresetId(serverActivePresetId)
    })
    saveWallpaperLayoutPresets(serverPresets)
    saveWallpaperActivePresetId(serverActivePresetId)
  }, [wallpaperSettingsQuery.data])

  const syncWallpaperPresetState = (
    nextPresets: WallpaperLayoutPreset[],
    nextActivePresetId: string | null,
    successMessage?: string,
  ) => {
    wallpaperPresetMutation.mutate(
      {
        wallpaperLayoutPresets: nextPresets,
        wallpaperActivePresetId: nextActivePresetId,
      },
      {
        onSuccess: (settings) => {
          setSavedPresets(settings.appearance.wallpaperLayoutPresets)
          setActivePresetId(settings.appearance.wallpaperActivePresetId)
          if (successMessage) {
            notifyInfo(successMessage)
          }
        },
        onError: (error) => {
          notifyError(error instanceof Error ? error.message : '월페이퍼 프리셋을 서버에 저장하지 못했어.')
        },
      },
    )
  }

  const handleLoadPreset = (presetId: string | null) => {
    if (!presetId) {
      setActivePresetId(null)
      syncWallpaperPresetState(savedPresets, null)
      return
    }

    const nextPreset = savedPresets.find((preset) => preset.id === presetId)
    if (!nextPreset) {
      return
    }

    const nextDraft = cloneWallpaperPresetToDraft(nextPreset)
    setActivePresetId(nextPreset.id)
    setLayoutPreset(nextDraft)
    setSelectedWidgetId(nextDraft.widgets[0]?.id ?? null)
    syncWallpaperPresetState(savedPresets, nextPreset.id)
  }

  const handleSavePreset = (options?: { saveAsNew?: boolean }) => {
    const nextResult = upsertWallpaperLayoutPreset(savedPresets, layoutPreset, {
      presetId: options?.saveAsNew ? null : effectiveActivePresetId,
      name: layoutPreset.name,
    })

    setSavedPresets(nextResult.presets)
    setActivePresetId(nextResult.presetId)
    syncWallpaperPresetState(
      nextResult.presets,
      nextResult.presetId,
      options?.saveAsNew ? '프리셋을 새로 저장했어.' : '프리셋을 저장했어.',
    )
  }

  const handleDeletePreset = () => {
    if (!effectiveActivePresetId) {
      return
    }

    const nextPresets = deleteWallpaperLayoutPreset(savedPresets, effectiveActivePresetId)
    setSavedPresets(nextPresets)
    setActivePresetId(null)
    syncWallpaperPresetState(nextPresets, null, '프리셋을 삭제했어.')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Wallpaper"
        title="Wallpaper Layout"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="min-w-[180px]"
              value={layoutPreset.canvasPresetId}
              onChange={(event) => {
                const nextPreset = getWallpaperCanvasPreset(event.target.value)
                setLayoutPreset((current) => normalizeWallpaperLayoutPreset({ ...current, canvasPresetId: nextPreset.id }, nextPreset))
              }}
            >
              {listWallpaperCanvasPresets().map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name} · {preset.aspectRatioLabel}</option>
              ))}
            </Select>
            <Button asChild variant="outline">
              <Link to="/wallpaper/runtime">Runtime Preview</Link>
            </Button>
          </div>
        )}
      />

      <section className="flex flex-wrap items-end gap-3 rounded-sm border border-border bg-surface-container/70 p-3">
        <div className="min-w-[200px] flex-1 space-y-1">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">Preset</div>
          <Select
            value={effectiveActivePresetId ?? ''}
            onChange={(event) => {
              handleLoadPreset(event.target.value || null)
            }}
          >
            <option value="">Draft only</option>
            {savedPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
        </div>

        <div className="min-w-[220px] flex-[1.2] space-y-1">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">Name</div>
          <input
            className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
            value={layoutPreset.name}
            onChange={(event) => {
              setLayoutPreset((current) => ({
                ...current,
                name: event.target.value,
                updatedAt: new Date().toISOString(),
              }))
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={wallpaperPresetMutation.isPending} onClick={() => handleSavePreset()}>
            Save
          </Button>
          <Button variant="outline" disabled={wallpaperPresetMutation.isPending} onClick={() => handleSavePreset({ saveAsNew: true })}>
            Save as new
          </Button>
          <Button variant="outline" disabled={!activePreset || wallpaperPresetMutation.isPending} onClick={handleDeletePreset}>
            Delete
          </Button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-4">
          <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">Widget Library</h2>
          <div className="space-y-2">
            {listWallpaperWidgetDefinitions().map((widget) => (
              <button
                key={widget.type}
                type="button"
                onClick={() => {
                  setLayoutPreset((current) => appendWallpaperWidget(current, widget.type))
                }}
                title={widget.description}
                className="flex w-full items-center gap-3 rounded-sm border border-border bg-surface-low px-3 py-3 text-left transition hover:border-secondary/70 hover:bg-surface-high"
              >
                <div className="mt-0.5 rounded-sm border border-border bg-background p-1.5 text-secondary">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 text-sm font-medium text-foreground">{widget.title}</div>
              </button>
            ))}
          </div>
        </section>

        <WallpaperCanvasView
          canvasPreset={canvasPreset}
          layoutPreset={layoutPreset}
          mode="editor"
          selectedWidgetId={effectiveSelectedWidgetId}
          onSelectWidget={setSelectedWidgetId}
          onUpdateWidgetFrame={(widgetId, patch) => {
            setLayoutPreset((current) => patchSelectedWidget(current, widgetId, patch))
          }}
        />

        <section className="space-y-4 rounded-sm border border-border bg-surface-container/70 p-4">
          <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">Widget Inspector</h2>

          {selectedWidget ? (
            <>
              <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                <div className="text-sm font-medium text-foreground">{getWallpaperWidgetDefinition(selectedWidget.type).title}</div>
                <SettingsField label="Title">
                  <input
                    className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
                    value={selectedWidget.settings.title}
                    onChange={(event) => {
                      setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                        settings: {
                          ...selectedWidget.settings,
                          title: event.target.value,
                        },
                      }))
                    }}
                  />
                </SettingsField>

                {selectedWidget.type === 'clock' ? (
                  <>
                    <SettingsField label="Time format">
                      <Select
                        value={selectedWidget.settings.timeFormat}
                        onChange={(event) => {
                          setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                            settings: {
                              ...selectedWidget.settings,
                              timeFormat: event.target.value === '12h' ? '12h' : '24h',
                            },
                          }))
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
                          setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                            settings: {
                              ...selectedWidget.settings,
                              showSeconds: event.target.checked,
                            },
                          }))
                        }}
                      />
                    </SettingsToggleRow>
                  </>
                ) : null}

                {selectedWidget.type === 'queue-status' ? (
                  <SettingsField label="Refresh">
                    <Select
                      value={String(selectedWidget.settings.refreshIntervalSec)}
                      onChange={(event) => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            refreshIntervalSec: Number(event.target.value),
                          },
                        }))
                      }}
                    >
                      {[5, 10, 15, 30].map((seconds) => (
                        <option key={seconds} value={seconds}>{seconds}s</option>
                      ))}
                    </Select>
                  </SettingsField>
                ) : null}

                {selectedWidget.type === 'image-showcase' ? (
                  <SettingsField label="Fit mode">
                    <Select
                      value={selectedWidget.settings.fitMode}
                      onChange={(event) => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            fitMode: event.target.value === 'contain' ? 'contain' : 'cover',
                          },
                        }))
                      }}
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </Select>
                  </SettingsField>
                ) : null}

                {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' ? (
                  <SettingsField label="Group">
                    <Select
                      value={selectedWidget.settings.groupId !== null ? String(selectedWidget.settings.groupId) : ''}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            groupId: nextValue ? Number(nextValue) : null,
                          },
                        }))
                      }}
                    >
                      <option value="">Select group</option>
                      {(groupsQuery.data ?? []).map((group) => (
                        <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
                      ))}
                    </Select>
                  </SettingsField>
                ) : null}

                {selectedWidget.type === 'group-image-view' ? (
                  <SettingsField label="Visible count">
                    <Select
                      className="w-full"
                      value={String(selectedWidget.settings.visibleCount)}
                      onChange={(event) => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            visibleCount: Number(event.target.value),
                          },
                        }))
                      }}
                    >
                      {[1, 2, 4, 6, 9].map((count) => (
                        <option key={count} value={count}>{count}</option>
                      ))}
                    </Select>
                  </SettingsField>
                ) : null}

                {selectedWidget.type === 'text-note' ? (
                  <SettingsField label="Text">
                    <textarea
                      className="theme-settings-control min-h-24 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                      value={selectedWidget.settings.text}
                      onChange={(event) => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            text: event.target.value,
                          },
                        }))
                      }}
                    />
                  </SettingsField>
                ) : null}

                {(selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase') ? (
                  <SettingsToggleRow>
                    <span className="flex-1">Include children</span>
                    <input
                      type="checkbox"
                      checked={selectedWidget.settings.includeChildren !== false}
                      onChange={(event) => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                          settings: {
                            ...selectedWidget.settings,
                            includeChildren: event.target.checked,
                          },
                        }))
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
                      setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                        settings: {
                          ...selectedWidget.settings,
                          showTitle: event.target.checked,
                        },
                      }))
                    }}
                  />
                </SettingsToggleRow>
                <SettingsToggleRow>
                  <span className="flex-1">Show background</span>
                  <input
                    type="checkbox"
                    checked={selectedWidget.settings.showBackground !== false}
                    onChange={(event) => {
                      setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, {
                        settings: {
                          ...selectedWidget.settings,
                          showBackground: event.target.checked,
                        },
                      }))
                    }}
                  />
                </SettingsToggleRow>
                <SettingsToggleRow>
                  <span className="flex-1">Hide widget</span>
                  <input
                    type="checkbox"
                    checked={selectedWidget.hidden}
                    onChange={(event) => {
                      setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, { hidden: event.target.checked }))
                    }}
                  />
                </SettingsToggleRow>
                <SettingsToggleRow>
                  <span className="flex-1">Lock widget</span>
                  <input
                    type="checkbox"
                    checked={selectedWidget.locked}
                    onChange={(event) => {
                      setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, { locked: event.target.checked }))
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
                      onClick={() => setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, patch))}
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
                  setLayoutPreset((current) => removeSelectedWidget(current, selectedWidget.id))
                }}
              >
                <Trash2 className="h-4 w-4" />
                Remove widget
              </Button>
            </>
          ) : (
            <div className={cn('rounded-sm border border-dashed border-border bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground')}>
              Select a widget.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
