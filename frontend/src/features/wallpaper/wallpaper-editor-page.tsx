import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Lock, Maximize2, Minimize2, Plus, Save, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { getGroupsHierarchyAll } from '@/lib/api'
import { getAppSettings, updateAppearanceSettings } from '@/lib/api-settings'
import { getWallpaperCanvasPreset, listWallpaperCanvasPresets } from './wallpaper-canvas-presets'
import {
  appendWallpaperWidget,
  buildWallpaperLayoutDraft,
  buildWallpaperStarterLayout,
  clampWallpaperWidgetInstance,
  cloneWallpaperPresetToDraft,
  deleteWallpaperLayoutPreset,
  loadWallpaperActivePresetId,
  getWallpaperWidgetsFrontToBack,
  loadWallpaperLayoutDraft,
  loadWallpaperLayoutPresets,
  moveWallpaperWidgetToOrder,
  normalizeWallpaperLayoutPreset,
  reorderWallpaperWidgets,
  saveWallpaperActivePresetId,
  saveWallpaperLayoutDraft,
  saveWallpaperLayoutPresets,
  upsertWallpaperLayoutPreset,
} from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import type { WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'
import { WallpaperWidgetInspector } from './wallpaper-widget-inspector'
import { WallpaperWidgetLibrarySidebar } from './wallpaper-widget-library-sidebar'

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
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null)
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null)
  const isCoarsePointer = useIsCoarsePointer()
  const [isCanvasFocusMode, setIsCanvasFocusMode] = useState(false)
  const [selectedLibraryWidgetType, setSelectedLibraryWidgetType] = useState<WallpaperWidgetType | null>(null)

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
  const orderedWidgets = useMemo(
    () => getWallpaperWidgetsFrontToBack(layoutPreset.widgets),
    [layoutPreset.widgets],
  )
  const draftRuntimePath = '/wallpaper/runtime'

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

  const handleCreateBlankCanvas = () => {
    const nextLayoutPreset = buildWallpaperLayoutDraft(layoutPreset.canvasPresetId)
    setActivePresetId(null)
    setLayoutPreset(nextLayoutPreset)
    setSelectedWidgetId(null)
    setSelectedLibraryWidgetType(null)
    syncWallpaperPresetState(savedPresets, null)
    notifyInfo('빈 신규 캔버스를 만들었어.')
  }

  const handleWidgetDrop = (targetWidgetId: string) => {
    if (!draggedWidgetId || draggedWidgetId === targetWidgetId) {
      setDraggedWidgetId(null)
      setDragOverWidgetId(null)
      return
    }

    const reorderedIds = orderedWidgets.map((widget) => widget.id)
    const draggedIndex = reorderedIds.indexOf(draggedWidgetId)
    const targetIndex = reorderedIds.indexOf(targetWidgetId)
    if (draggedIndex < 0 || targetIndex < 0) {
      setDraggedWidgetId(null)
      setDragOverWidgetId(null)
      return
    }

    reorderedIds.splice(draggedIndex, 1)
    reorderedIds.splice(targetIndex, 0, draggedWidgetId)
    setLayoutPreset((current) => reorderWallpaperWidgets(current, reorderedIds))
    setSelectedWidgetId(draggedWidgetId)
    setDraggedWidgetId(null)
    setDragOverWidgetId(null)
  }

  const handleAddWidget = (widgetType: WallpaperWidgetType) => {
    const nextLayoutPreset = appendWallpaperWidget(layoutPreset, widgetType)
    setLayoutPreset(nextLayoutPreset)
    setSelectedLibraryWidgetType(widgetType)
    setSelectedWidgetId(nextLayoutPreset.widgets[nextLayoutPreset.widgets.length - 1]?.id ?? null)
  }

  const handleChangeCanvasPreset = (canvasPresetId: string) => {
    const nextPreset = getWallpaperCanvasPreset(canvasPresetId)
    setLayoutPreset((current) => normalizeWallpaperLayoutPreset({ ...current, canvasPresetId: nextPreset.id }, nextPreset))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="월페이퍼"
        title="월페이퍼 배치"
      />

      <section className="rounded-sm border border-border bg-surface-container/70 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(200px,0.9fr)_minmax(220px,1.2fr)_auto] lg:items-end">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">프리셋</div>
            <Select
              value={effectiveActivePresetId ?? '__new__'}
              onChange={(event) => {
                handleLoadPreset(event.target.value || null)
              }}
            >
              <option value="__new__" hidden>미저장 새 캔버스</option>
              {savedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">이름</div>
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

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={wallpaperPresetMutation.isPending}
              onClick={handleCreateBlankCanvas}
              aria-label="신규 캔버스"
              title="신규 캔버스"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={wallpaperPresetMutation.isPending}
              onClick={() => handleSavePreset()}
              aria-label="저장"
              title="저장"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={wallpaperPresetMutation.isPending}
              onClick={() => handleSavePreset({ saveAsNew: true })}
              aria-label="다른 이름으로 저장"
              title="다른 이름으로 저장"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!activePreset || wallpaperPresetMutation.isPending}
              onClick={handleDeletePreset}
              aria-label="프리셋 삭제"
              title="프리셋 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <div className={isCanvasFocusMode ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]' : 'grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]'}>
        {!isCanvasFocusMode ? (
          <WallpaperWidgetLibrarySidebar
            selectedWidgetType={selectedLibraryWidgetType}
            onAddWidget={handleAddWidget}
          />
        ) : null}

        <div className="space-y-3">
          <WallpaperCanvasView
            canvasPreset={canvasPreset}
            layoutPreset={layoutPreset}
            mode="editor"
            selectedWidgetId={effectiveSelectedWidgetId}
            editorHeader={(
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Select
                    className="min-w-[180px]"
                    value={layoutPreset.canvasPresetId}
                    onChange={(event) => {
                      handleChangeCanvasPreset(event.target.value)
                    }}
                  >
                    {listWallpaperCanvasPresets().map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.name} · {preset.aspectRatioLabel}</option>
                    ))}
                  </Select>
                  <span className="text-[11px] text-muted-foreground">{canvasPreset.gridColumns}×{canvasPreset.gridRows}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="icon-sm" aria-label="초안 런타임 미리보기" title="초안 런타임 미리보기">
                    <Link to={draftRuntimePath}>
                      <Eye className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setIsCanvasFocusMode((current) => !current)}
                    aria-label={isCanvasFocusMode ? '집중 보기 종료' : '캔버스 집중 보기'}
                    title={isCanvasFocusMode ? '집중 보기 종료' : '캔버스 집중 보기'}
                  >
                    {isCanvasFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
            onSelectWidget={setSelectedWidgetId}
            onUpdateWidgetFrame={(widgetId, patch) => {
              setLayoutPreset((current) => patchSelectedWidget(current, widgetId, patch))
            }}
          />

          <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-4">
            <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">선택 위젯 컨트롤</h2>

            {selectedWidget ? (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
                  {[
                    ['X', selectedWidget.x],
                    ['Y', selectedWidget.y],
                    ['W', selectedWidget.w],
                    ['H', selectedWidget.h],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="inline-flex items-center gap-1.5">
                      <span className="font-semibold tracking-[0.16em] uppercase">{label}</span>
                      <span className="text-sm font-medium text-foreground">{value}</span>
                    </div>
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
                      onClick={() => {
                        setLayoutPreset((current) => patchSelectedWidget(current, selectedWidget.id, patch))
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setLayoutPreset((current) => removeSelectedWidget(current, selectedWidget.id))
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    위젯 삭제
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-sm border border-dashed border-border bg-surface-low px-4 py-6 text-center text-sm text-muted-foreground">
                위젯을 선택해.
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-4">
            <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">위젯 순서</h2>

            {orderedWidgets.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border bg-surface-low px-4 py-6 text-center text-sm text-muted-foreground">
                아직 추가된 위젯이 없어.
              </div>
            ) : (
              <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                {orderedWidgets.map((widget, index) => {
                  const isSelected = effectiveSelectedWidgetId === widget.id
                  const isDragOver = dragOverWidgetId === widget.id && draggedWidgetId !== widget.id
                  return (
                    <div
                      key={widget.id}
                      className={`flex w-full items-center gap-3 rounded-sm border px-3 py-2 text-left transition ${isSelected ? 'border-secondary bg-secondary/10' : 'border-border bg-surface-low hover:border-secondary/60 hover:bg-surface-high'} ${isDragOver ? 'border-primary border-dashed bg-primary/8' : ''}`}
                      draggable={!isCoarsePointer}
                      onDragStart={() => {
                        if (isCoarsePointer) {
                          return
                        }
                        setDraggedWidgetId(widget.id)
                        setDragOverWidgetId(widget.id)
                      }}
                      onDragOver={(event) => {
                        if (isCoarsePointer) {
                          return
                        }
                        event.preventDefault()
                        if (draggedWidgetId !== widget.id) {
                          setDragOverWidgetId(widget.id)
                        }
                      }}
                      onDrop={(event) => {
                        if (isCoarsePointer) {
                          return
                        }
                        event.preventDefault()
                        handleWidgetDrop(widget.id)
                      }}
                      onDragEnd={() => {
                        setDraggedWidgetId(null)
                        setDragOverWidgetId(null)
                      }}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        onClick={() => setSelectedWidgetId(widget.id)}
                      >
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <GripVertical className="h-4 w-4" />
                          <span className="w-5 text-center text-xs font-semibold">{index + 1}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{String(widget.settings.title ?? widget.type)}</div>
                          <div className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{widget.type}</div>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        {isCoarsePointer ? (
                          <>
                            <button
                              type="button"
                              aria-label="앞으로 이동"
                              disabled={index === 0}
                              className="flex h-8 w-8 touch-none items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={(event) => {
                                event.stopPropagation()
                                setLayoutPreset((current) => moveWallpaperWidgetToOrder(current, widget.id, index))
                                setSelectedWidgetId(widget.id)
                              }}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="뒤로 이동"
                              disabled={index === orderedWidgets.length - 1}
                              className="flex h-8 w-8 touch-none items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={(event) => {
                                event.stopPropagation()
                                setLayoutPreset((current) => moveWallpaperWidgetToOrder(current, widget.id, index + 2))
                                setSelectedWidgetId(widget.id)
                              }}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                        {widget.hidden ? <EyeOff className="h-3.5 w-3.5" /> : null}
                        {widget.locked ? <Lock className="h-3.5 w-3.5" /> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <section className="space-y-4 rounded-sm border border-border bg-surface-container/70 p-4">
          <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">위젯 설정</h2>

          <WallpaperWidgetInspector
            selectedWidget={selectedWidget}
            groups={groupsQuery.data ?? []}
            onPatchWidget={(widgetId, patch) => {
              setLayoutPreset((current) => patchSelectedWidget(current, widgetId, patch))
            }}
          />
        </section>
      </div>
    </div>
  )
}
