import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Copy, EyeOff, GripVertical, Lock, Maximize2, Minimize2, Plus } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { getGroupsHierarchyAll } from '@/lib/api'
import { getAppSettings, updateAppearanceSettings } from '@/lib/api-settings'
import { getWallpaperCanvasPreset, listWallpaperCanvasPresets } from './wallpaper-canvas-presets'
import {
  appendWallpaperWidget,
  buildWallpaperPresetQueryValue,
  buildWallpaperRuntimeAbsoluteUrl,
  buildWallpaperRuntimePath,
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
import { listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import type { WallpaperLayoutPreset, WallpaperWidgetInstance } from './wallpaper-types'
import { WallpaperWidgetInspector } from './wallpaper-widget-inspector'

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
  const [isCanvasFocusMode, setIsCanvasFocusMode] = useState(false)

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
  const selectedWidgetOrder = useMemo(
    () => (effectiveSelectedWidgetId ? orderedWidgets.findIndex((widget) => widget.id === effectiveSelectedWidgetId) + 1 : null),
    [effectiveSelectedWidgetId, orderedWidgets],
  )
  const draftRuntimePath = '/wallpaper/runtime'
  const hasFixedRuntimeUrl = Boolean(activePreset)
  const activeRuntimePath = useMemo(() => buildWallpaperRuntimePath(activePreset), [activePreset])
  const activeRuntimeAbsoluteUrl = useMemo(() => buildWallpaperRuntimeAbsoluteUrl(activeRuntimePath), [activeRuntimePath])

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

  const handleCopyRuntimeUrl = async () => {
    if (!activePreset) {
      notifyError('고정 runtime URL은 저장된 프리셋을 먼저 선택하거나 저장해야 해.')
      return
    }

    try {
      await navigator.clipboard.writeText(activeRuntimeAbsoluteUrl)
      notifyInfo(`런타임 URL을 복사했어. (${buildWallpaperPresetQueryValue(activePreset)})`)
    } catch {
      notifyError('런타임 URL을 복사하지 못했어.')
    }
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="월페이퍼"
        title="월페이퍼 배치"
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
              <Link to={draftRuntimePath}>초안 런타임 미리보기</Link>
            </Button>
            <Button variant="outline" onClick={() => setIsCanvasFocusMode((current) => !current)}>
              {isCanvasFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {isCanvasFocusMode ? '집중 보기 종료' : '캔버스 집중 보기'}
            </Button>
            {hasFixedRuntimeUrl ? (
              <Button asChild variant="outline">
                <Link to={activeRuntimePath}>저장 프리셋 열기</Link>
              </Button>
            ) : null}
          </div>
        )}
      />

      <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
        <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 space-y-1">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">프리셋</div>
          <Select
            value={effectiveActivePresetId ?? ''}
            onChange={(event) => {
              handleLoadPreset(event.target.value || null)
            }}
          >
            <option value="">초안만</option>
            {savedPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
        </div>

        <div className="min-w-[220px] flex-[1.2] space-y-1">
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

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={wallpaperPresetMutation.isPending} onClick={() => handleSavePreset()}>
            저장
          </Button>
          <Button variant="outline" disabled={wallpaperPresetMutation.isPending} onClick={() => handleSavePreset({ saveAsNew: true })}>
            다른 이름으로 저장
          </Button>
          <Button variant="outline" disabled={!activePreset || wallpaperPresetMutation.isPending} onClick={handleDeletePreset}>
            삭제
          </Button>
        </div>
        </div>

        <div className="grid gap-3 rounded-sm border border-border/70 bg-surface-low/70 p-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">미리보기 기준</div>
            <p className="text-sm text-muted-foreground">
              에디터는 항상 현재 초안을 기준으로 보여줘. 실제 고정 적용 화면은 아래 저장 프리셋 URL을 쓰니까, 저장 전에는 둘이 다를 수 있어.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">고정 런타임 URL</div>
              <input
                readOnly
                value={activePreset ? activeRuntimeAbsoluteUrl : ''}
                placeholder="저장된 프리셋을 선택하거나 저장하면 고정 URL이 생겨"
                className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none"
              />
            </div>
            {hasFixedRuntimeUrl ? (
              <Button asChild variant="outline">
                <Link to={activeRuntimePath}>저장 프리셋 열기</Link>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                저장 프리셋 열기
              </Button>
            )}
            <Button variant="outline" disabled={!hasFixedRuntimeUrl} onClick={() => { void handleCopyRuntimeUrl() }}>
              <Copy className="h-4 w-4" />
              URL 복사
            </Button>
          </div>
        </div>
      </section>

      <div className={isCanvasFocusMode ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]' : 'grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]'}>
        {!isCanvasFocusMode ? (
          <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-4">
          <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">위젯 라이브러리</h2>
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
        ) : null}

        <div className="space-y-3">
          {isCanvasFocusMode ? (
            <div className="rounded-sm border border-border bg-surface-container/70 px-4 py-3 text-sm text-muted-foreground">
              집중 보기에서는 캔버스를 넓게 보여줘서 실제 런타임 배치 감각을 더 가깝게 확인할 수 있어.
            </div>
          ) : null}

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

          <section className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-[0.18em] text-secondary uppercase">위젯 순서</h2>
              <div className="text-xs text-muted-foreground">위 = 앞, 아래 = 뒤. 드래그해서 순서를 바꿀 수 있어.</div>
            </div>

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
                    <button
                      key={widget.id}
                      type="button"
                      draggable
                      onClick={() => setSelectedWidgetId(widget.id)}
                      onDragStart={() => {
                        setDraggedWidgetId(widget.id)
                        setDragOverWidgetId(widget.id)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        if (draggedWidgetId !== widget.id) {
                          setDragOverWidgetId(widget.id)
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        handleWidgetDrop(widget.id)
                      }}
                      onDragEnd={() => {
                        setDraggedWidgetId(null)
                        setDragOverWidgetId(null)
                      }}
                      className={`flex w-full items-center gap-3 rounded-sm border px-3 py-2 text-left transition ${isSelected ? 'border-secondary bg-secondary/10' : 'border-border bg-surface-low hover:border-secondary/60 hover:bg-surface-high'} ${isDragOver ? 'border-primary border-dashed bg-primary/8' : ''}`}
                    >
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <GripVertical className="h-4 w-4" />
                        <span className="w-5 text-center text-xs font-semibold">{index + 1}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{String(widget.settings.title ?? widget.type)}</div>
                        <div className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{widget.type}</div>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        {widget.hidden ? <EyeOff className="h-3.5 w-3.5" /> : null}
                        {widget.locked ? <Lock className="h-3.5 w-3.5" /> : null}
                      </div>
                    </button>
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
            widgetCount={orderedWidgets.length}
            widgetOrder={selectedWidgetOrder}
            onPatchWidget={(widgetId, patch) => {
              setLayoutPreset((current) => patchSelectedWidget(current, widgetId, patch))
            }}
            onChangeWidgetOrder={(widgetId, nextOrder) => {
              setLayoutPreset((current) => moveWallpaperWidgetToOrder(current, widgetId, nextOrder))
            }}
            onRemoveWidget={(widgetId) => {
              setLayoutPreset((current) => removeSelectedWidget(current, widgetId))
            }}
          />
        </section>
      </div>
    </div>
  )
}
