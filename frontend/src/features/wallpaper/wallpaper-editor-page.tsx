import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ClipboardCopy, Copy, ExternalLink, Eye, EyeOff, GripVertical, HelpCircle, LayoutTemplate, Lock, Maximize2, Minimize2, MoreHorizontal, Plus, Redo2, Save, Trash2, Undo2 } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { getGroupsHierarchyAll } from '@/lib/api-groups'
import { getAppSettings } from '@/lib/api-settings-general'
import { updateAppearanceSettings } from '@/lib/api-settings-appearance'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getWallpaperCanvasPreset, listWallpaperCanvasPresets } from './wallpaper-canvas-presets'
import {
  appendWallpaperWidget,
  buildWallpaperDraftRuntimePath,
  buildWallpaperLayoutDraft,
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
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import {
  toWallpaperLayoutPresetViewModels,
  toWallpaperLayoutPresetWireModels,
  type WallpaperLayoutPreset,
  type WallpaperWidgetInstance,
  type WallpaperWidgetType,
} from './wallpaper-types'
import { WallpaperWidgetInspector } from './wallpaper-widget-inspector'
import { WallpaperWidgetLibrarySidebar } from './wallpaper-widget-library-sidebar'
import { getWallpaperWidgetDefinition, getWallpaperWidgetDisplayTitle } from './wallpaper-widget-registry'
import { WallpaperLivelyHelpModal } from './wallpaper-lively-help-modal'
import { WallpaperTemplateModal } from './wallpaper-template-modal'
import { useUndoableState } from './use-undoable-state'
import { useWallpaperLeaveGuard } from './use-wallpaper-leave-guard'
import { buildWallpaperTemplateLayout, type WallpaperTemplateDefinition } from './wallpaper-templates'

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
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const hasHydratedServerPresetsRef = useRef(false)
  // Widget edits go through a bounded undo history; loading a preset, a new canvas or a template resets it.
  const {
    value: layoutPreset,
    set: setLayoutPreset,
    reset: resetLayoutPreset,
    undo: undoLayoutEdit,
    redo: redoLayoutEdit,
    canUndo,
    canRedo,
  } = useUndoableState(() => loadWallpaperLayoutDraft() ?? buildWallpaperStarterLayout('landscape-1080p'), { limit: 60 })
  const [savedPresets, setSavedPresets] = useState(() => loadWallpaperLayoutPresets())
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadWallpaperActivePresetId())
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null)
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null)
  const isCoarsePointer = useIsCoarsePointer()
  const [isCanvasFocusMode, setIsCanvasFocusMode] = useState(false)
  const [selectedLibraryWidgetType, setSelectedLibraryWidgetType] = useState<WallpaperWidgetType | null>(null)
  const [isLivelyHelpOpen, setIsLivelyHelpOpen] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const workspaceMenuAnchorRef = useRef<HTMLButtonElement | null>(null)

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
      updateAppearanceSettings({
        wallpaperLayoutPresets: toWallpaperLayoutPresetWireModels(wallpaperLayoutPresets),
        wallpaperActivePresetId,
      })
    ),
  })

  const canvasPreset = useMemo(() => getWallpaperCanvasPreset(layoutPreset.canvasPresetId), [layoutPreset.canvasPresetId])
  const savedPresetById = useMemo(() => new Map(savedPresets.map((preset) => [preset.id, preset])), [savedPresets])
  const widgetById = useMemo(() => new Map(layoutPreset.widgets.map((widget) => [widget.id, widget])), [layoutPreset.widgets])
  const effectiveActivePresetId = useMemo(
    () => (activePresetId && savedPresetById.has(activePresetId) ? activePresetId : null),
    [activePresetId, savedPresetById],
  )
  const activePreset = useMemo(
    () => (effectiveActivePresetId ? (savedPresetById.get(effectiveActivePresetId) ?? null) : null),
    [effectiveActivePresetId, savedPresetById],
  )
  // Compare only what saving persists; both sides are normalized so clamping or defaults never read as edits.
  const hasUnsavedPresetChanges = useMemo(() => {
    if (!activePreset) {
      return false
    }
    const toSignature = (preset: WallpaperLayoutPreset) => {
      const normalized = normalizeWallpaperLayoutPreset(preset)
      return JSON.stringify([normalized.canvasPresetId, normalized.widgets, normalized.unsupportedWidgets ?? []])
    }
    const draftName = layoutPreset.name.trim() || activePreset.name
    return draftName !== activePreset.name || toSignature(layoutPreset) !== toSignature(activePreset)
  }, [activePreset, layoutPreset])
  // With a saved preset, only differences from it count. Without one, the draft already lives in this browser,
  // so leaving only warns about edits made in this visit, while replacing the canvas warns whenever it has widgets.
  const hasUnsavedEdits = activePreset ? hasUnsavedPresetChanges : canUndo
  const hasDiscardableEdits = activePreset ? hasUnsavedPresetChanges : layoutPreset.widgets.length > 0
  useWallpaperLeaveGuard(
    hasUnsavedEdits,
    t({ ko: '프리셋에 저장하지 않은 월페이퍼 변경이 있어. 초안은 이 브라우저에 남지만 저장된 월페이퍼에는 반영되지 않아. 나갈까?', en: 'You have wallpaper changes that are not saved to a preset. The draft stays in this browser, but the saved wallpaper does not change. Leave?' }),
  )

  const effectiveSelectedWidgetId = useMemo(
    () => (selectedWidgetId && widgetById.has(selectedWidgetId) ? selectedWidgetId : (layoutPreset.widgets[0]?.id ?? null)),
    [layoutPreset.widgets, selectedWidgetId, widgetById],
  )
  const selectedWidget = useMemo(
    () => (effectiveSelectedWidgetId ? (widgetById.get(effectiveSelectedWidgetId) ?? null) : null),
    [effectiveSelectedWidgetId, widgetById],
  )
  const orderedWidgets = useMemo(
    () => getWallpaperWidgetsFrontToBack(layoutPreset.widgets),
    [layoutPreset.widgets],
  )
  const draftRuntimePath = buildWallpaperDraftRuntimePath()
  const activePresetRuntimePath = activePreset ? buildWallpaperRuntimePath(activePreset) : null
  const activePresetRuntimeUrl = activePresetRuntimePath && typeof window !== 'undefined'
    ? new URL(activePresetRuntimePath, window.location.origin).toString()
    : ''

  useEffect(() => {
    saveWallpaperLayoutDraft(layoutPreset)
  }, [layoutPreset])

  useEffect(() => {
    saveWallpaperLayoutPresets(savedPresets)
  }, [savedPresets])

  useEffect(() => {
    saveWallpaperActivePresetId(effectiveActivePresetId)
  }, [effectiveActivePresetId])

  // Ctrl/Cmd+Z undoes widget edits, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes; text fields keep their own undo.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undoLayoutEdit()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redoLayoutEdit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [redoLayoutEdit, undoLayoutEdit])

  useEffect(() => {
    if (hasHydratedServerPresetsRef.current || !wallpaperSettingsQuery.data) {
      return
    }

    hasHydratedServerPresetsRef.current = true
    const serverPresets = toWallpaperLayoutPresetViewModels(wallpaperSettingsQuery.data.appearance.wallpaperLayoutPresets)
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
          setSavedPresets(toWallpaperLayoutPresetViewModels(settings.appearance.wallpaperLayoutPresets))
          setActivePresetId(settings.appearance.wallpaperActivePresetId)
          if (successMessage) {
            notifyInfo(successMessage)
          }
        },
        onError: (error) => {
          notifyError(error instanceof Error ? error.message : t({ ko: '월페이퍼 프리셋을 서버에 저장하지 못했어.', en: 'Failed to save the wallpaper preset to the server.' }))
        },
      },
    )
  }

  /** Ask before an action replaces the current canvas while it has unsaved edits. */
  const confirmDiscardEdits = async (title: string, confirmLabel: string) => {
    if (!hasDiscardableEdits) {
      return true
    }

    return confirm({
      title,
      description: activePreset
        ? t({ ko: "'{name}'에 저장하지 않은 변경이 있어. 계속하면 지금 편집 중인 내용이 사라져.", en: "'{name}' has unsaved changes. Continuing discards what you are editing." }, { name: activePreset.name })
        : t({ ko: '저장하지 않은 새 캔버스야. 계속하면 지금 편집 중인 위젯이 사라져.', en: 'This new canvas is not saved. Continuing discards the widgets you are editing.' }),
      confirmLabel,
      tone: 'destructive',
    })
  }

  const handleLoadPreset = async (presetId: string | null) => {
    if (presetId && presetId !== effectiveActivePresetId && !(await confirmDiscardEdits(
      t({ ko: '다른 프리셋 불러오기', en: 'Load another preset' }),
      t({ ko: '불러오기', en: 'Load' }),
    ))) {
      return
    }

    if (!presetId) {
      setActivePresetId(null)
      syncWallpaperPresetState(savedPresets, null)
      return
    }

    const nextPreset = savedPresetById.get(presetId)
    if (!nextPreset) {
      return
    }

    const nextDraft = cloneWallpaperPresetToDraft(nextPreset)
    setActivePresetId(nextPreset.id)
    resetLayoutPreset(nextDraft)
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
      options?.saveAsNew
        ? t({ ko: '프리셋을 새로 저장했어.', en: 'Saved the preset as a new one.' })
        : t({ ko: '프리셋을 저장했어.', en: 'Saved the preset.' }),
    )
  }

  const handleDeletePreset = async () => {
    if (!effectiveActivePresetId) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '월페이퍼 삭제', en: 'Delete wallpaper' }),
      description: t({
        ko: "정말 '{name}' 월페이퍼를 삭제할까? 이 작업은 되돌릴 수 없어.",
        en: "Delete the '{name}' wallpaper? This cannot be undone.",
      }, { name: activePreset?.name ?? layoutPreset.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    const nextPresets = deleteWallpaperLayoutPreset(savedPresets, effectiveActivePresetId)
    syncWallpaperPresetState(nextPresets, null, t({ ko: '프리셋을 삭제했어.', en: 'Deleted the preset.' }))
  }

  const handleCopyRuntimeUrl = async () => {
    if (!activePresetRuntimeUrl) {
      return
    }

    try {
      await copyTextToClipboard(activePresetRuntimeUrl)
      notifyInfo(t({ ko: '월페이퍼 URL을 복사했어.', en: 'Copied the wallpaper URL.' }))
    } catch {
      notifyError(t({ ko: '월페이퍼 URL을 복사하지 못했어.', en: 'Failed to copy the wallpaper URL.' }))
    }
  }

  const handleCreateBlankCanvas = async () => {
    if (!(await confirmDiscardEdits(t({ ko: '새 캔버스', en: 'New canvas' }), t({ ko: '새로 만들기', en: 'Create' })))) {
      return
    }

    const nextLayoutPreset = buildWallpaperLayoutDraft(layoutPreset.canvasPresetId)
    setActivePresetId(null)
    resetLayoutPreset(nextLayoutPreset)
    setSelectedWidgetId(null)
    setSelectedLibraryWidgetType(null)
    syncWallpaperPresetState(savedPresets, null)
    notifyInfo(t({ ko: '빈 신규 캔버스를 만들었어.', en: 'Created a new blank canvas.' }))
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

  const handleApplyTemplate = async (template: WallpaperTemplateDefinition) => {
    if (layoutPreset.widgets.length > 0 && !(await confirm({
      title: t({ ko: '템플릿 적용', en: 'Apply template' }),
      description: t({
        ko: '현재 초안의 위젯을 템플릿으로 교체할까? 저장된 프리셋은 영향을 받지 않아.',
        en: 'Replace widgets in the current draft with this template? Saved presets are not affected.',
      }),
      confirmLabel: t({ ko: '교체', en: 'Replace' }),
      tone: 'destructive',
    }))) {
      return
    }

    const nextLayout = buildWallpaperTemplateLayout(template.id, layoutPreset.canvasPresetId, t(template.name))
    setActivePresetId(null)
    resetLayoutPreset(nextLayout)
    setSelectedWidgetId(nextLayout.widgets[0]?.id ?? null)
    setSelectedLibraryWidgetType(null)
    setIsTemplateModalOpen(false)
    syncWallpaperPresetState(savedPresets, null)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ ko: '월페이퍼 스튜디오', en: 'Wallpaper Studio' })}
        titleAccessory={(
          <Badge variant="secondary" className="normal-case tracking-normal">
            {activePreset && !hasUnsavedPresetChanges ? <Check className="text-secondary-text" /> : null}
            {!activePreset
              ? t({ ko: '초안', en: 'Draft' })
              : hasUnsavedPresetChanges
                ? t({ ko: '저장 안 된 변경', en: 'Unsaved changes' })
                : t({ ko: '저장됨', en: 'Saved' })}
          </Badge>
        )}
        description={t({ ko: '캔버스를 편집하고 Lively용 URL로 바로 실행해.', en: 'Compose the canvas and run it directly in Lively.' })}
        actions={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsTemplateModalOpen(true)}>
              <LayoutTemplate className="h-4 w-4" />
              <span className="hidden sm:inline">{t({ ko: '템플릿', en: 'Templates' })}</span>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={draftRuntimePath} target="_blank" rel="noreferrer">
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline">{t({ ko: '미리보기', en: 'Preview' })}</span>
              </a>
            </Button>
            <div className="flex items-center gap-1">
              <IconButton variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undoLayoutEdit} label={t({ ko: '실행 취소 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' })}>
                <Undo2 className="h-4 w-4" />
              </IconButton>
              <IconButton variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redoLayoutEdit} label={t({ ko: '다시 실행 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' })}>
                <Redo2 className="h-4 w-4" />
              </IconButton>
            </div>
            <Button size="sm" disabled={wallpaperPresetMutation.isPending} onClick={() => handleSavePreset()}>
              <Save className="h-4 w-4" />
              {t({ ko: '저장', en: 'Save' })}
            </Button>
            <Button
              ref={workspaceMenuAnchorRef}
              variant="secondary"
              size="icon-sm"
              aria-label={t({ ko: '더 많은 작업', en: 'More actions' })}
              title={t({ ko: '더 많은 작업', en: 'More actions' })}
              onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsLivelyHelpOpen(true)}
              aria-label={t({ ko: 'Lively 연결 도움말', en: 'Lively connection help' })}
              title={t({ ko: 'Lively 연결 도움말', en: 'Lively connection help' })}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </>
        )}
      />

      <Panel tone="low" padding="none" className="overflow-hidden">
        <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(190px,0.75fr)_minmax(220px,1.15fr)_minmax(190px,0.7fr)] lg:items-end">
          <Field label={t({ ko: '프리셋', en: 'Preset' })}>
            <Select
              value={effectiveActivePresetId ?? '__new__'}
              onChange={(event) => {
                void handleLoadPreset(event.target.value === '__new__' ? null : event.target.value)
              }}
            >
              <option value="__new__" hidden>{t({ ko: '미저장 새 캔버스', en: 'Unsaved new canvas' })}</option>
              {savedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </Select>
          </Field>

          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input
              variant="settings"
              value={layoutPreset.name}
              onChange={(event) => {
                const name = event.target.value
                setLayoutPreset((current) => ({
                  ...current,
                  name,
                  updatedAt: new Date().toISOString(),
                }), { coalesceKey: 'name' })
              }}
            />
          </Field>
          <Field label={t({ ko: '캔버스', en: 'Canvas' })}>
            <Select value={layoutPreset.canvasPresetId} onChange={(event) => handleChangeCanvasPreset(event.target.value)}>
              {listWallpaperCanvasPresets().map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name} · {preset.aspectRatioLabel}</option>
              ))}
            </Select>
          </Field>
        </div>

        {activePresetRuntimePath ? (
          <Button
            type="button"
            variant="nav"
            size="sm"
            className="h-auto rounded-none bg-surface-lowest px-4 py-2 text-xs"
            onClick={() => void handleCopyRuntimeUrl()}
          >
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0 text-secondary-text" />
            <span className="shrink-0 font-medium">{t({ ko: 'Lively URL', en: 'Lively URL' })}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-2xs">{activePresetRuntimeUrl}</span>
            <span className="shrink-0">{t({ ko: '복사', en: 'Copy' })}</span>
          </Button>
        ) : (
          <div className="bg-surface-lowest px-4 py-2 text-xs text-muted-foreground">
            {t({ ko: '저장하면 Lively용 고유 URL이 생성돼.', en: 'Save once to create a unique Lively URL.' })}
          </div>
        )}
      </Panel>

      <AnchoredPopup
        open={isWorkspaceMenuOpen}
        anchorRef={workspaceMenuAnchorRef}
        onClose={() => setIsWorkspaceMenuOpen(false)}
        className="w-64 p-2"
      >
        <Text as="div" variant="overline" className="px-2 pb-2 pt-1 font-semibold">{t({ ko: '프리셋 작업', en: 'Preset actions' })}</Text>
        {[
          { icon: Plus, label: t({ ko: '새 캔버스', en: 'New canvas' }), disabled: false, action: () => void handleCreateBlankCanvas() },
          { icon: Copy, label: t({ ko: '다른 이름으로 저장', en: 'Save as new' }), disabled: wallpaperPresetMutation.isPending, action: () => handleSavePreset({ saveAsNew: true }) },
          { icon: ClipboardCopy, label: t({ ko: 'Lively URL 복사', en: 'Copy Lively URL' }), disabled: !activePresetRuntimeUrl, action: () => void handleCopyRuntimeUrl() },
          { icon: ExternalLink, label: t({ ko: '저장 월페이퍼 열기', en: 'Open saved wallpaper' }), disabled: !activePresetRuntimePath, action: () => activePresetRuntimePath && window.open(activePresetRuntimePath, '_blank', 'noopener,noreferrer') },
          { icon: Trash2, label: t({ ko: '프리셋 삭제', en: 'Delete preset' }), disabled: !activePreset || wallpaperPresetMutation.isPending, action: handleDeletePreset, destructive: true },
        ].map(({ icon: Icon, label, disabled, action, destructive }) => (
          <Button
            key={label}
            type="button"
            variant="nav"
            disabled={disabled}
            className={destructive ? 'gap-3 text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground' : 'gap-3 text-foreground'}
            onClick={() => {
              setIsWorkspaceMenuOpen(false)
              action()
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </AnchoredPopup>

      <div className={isCanvasFocusMode ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]' : 'grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_310px]'}>
        {!isCanvasFocusMode ? (
          <WallpaperWidgetLibrarySidebar
            selectedWidgetType={selectedLibraryWidgetType}
            onAddWidget={handleAddWidget}
          />
        ) : null}

        <div className="min-w-0 space-y-3">
          <WallpaperCanvasView
            canvasPreset={canvasPreset}
            layoutPreset={layoutPreset}
            mode="editor"
            selectedWidgetId={effectiveSelectedWidgetId}
            editorHeader={(
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{canvasPreset.name}</span>
                  <Badge variant="secondary" className="normal-case tracking-normal">{canvasPreset.aspectRatioLabel} · {canvasPreset.gridColumns}×{canvasPreset.gridRows}</Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => setIsCanvasFocusMode((current) => !current)}
                    aria-label={isCanvasFocusMode
                      ? t({ ko: '집중 보기 종료', en: 'Exit focus view' })
                      : t({ ko: '캔버스 집중 보기', en: 'Focus canvas' })}
                    title={isCanvasFocusMode
                      ? t({ ko: '집중 보기 종료', en: 'Exit focus view' })
                      : t({ ko: '캔버스 집중 보기', en: 'Focus canvas' })}
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

          <Panel asChild tone="low" stack>
            <section>
            <Heading level={3}>{t({ ko: '선택 위젯 컨트롤', en: 'Selected widget controls' })}</Heading>

            {selectedWidget ? (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm bg-surface-lowest px-3 py-2 text-xs text-muted-foreground">
                  {[
                    ['X', selectedWidget.x],
                    ['Y', selectedWidget.y],
                    ['W', selectedWidget.w],
                    ['H', selectedWidget.h],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="inline-flex items-center gap-1.5">
                      <span className="text-2xs font-semibold uppercase tracking-overline">{label}</span>
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
                      variant="secondary"
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
                      notifyInfo(t({ ko: '위젯을 삭제했어. 실행 취소(Ctrl+Z)로 되돌릴 수 있어.', en: 'Widget deleted. Undo (Ctrl+Z) brings it back.' }))
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t({ ko: '위젯 삭제', en: 'Delete widget' })}
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState size="compact" title={t({ ko: '위젯을 선택해.', en: 'Select a widget.' })} />
            )}
            </section>
          </Panel>

          <Panel asChild tone="low" stack>
            <section>
            <Heading level={3}>{t({ ko: '위젯 순서', en: 'Widget order' })}</Heading>

            {orderedWidgets.length === 0 ? (
              <EmptyState size="compact" title={t({ ko: '아직 추가된 위젯이 없어.', en: 'No widgets added yet.' })} />
            ) : (
              <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                {orderedWidgets.map((widget, index) => {
                  const isSelected = effectiveSelectedWidgetId === widget.id
                  const isDragOver = dragOverWidgetId === widget.id && draggedWidgetId !== widget.id
                  return (
                    <div
                      key={widget.id}
                      className={`flex w-full items-center gap-1 rounded-sm pr-2 transition-colors ${isSelected ? 'bg-primary/12' : 'bg-surface-lowest'} ${isDragOver ? 'ring-1 ring-primary/60' : ''}`}
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
                      <Button
                        type="button"
                        variant="nav"
                        className="h-auto min-w-0 flex-1 gap-3 px-3 py-2"
                        aria-current={isSelected ? 'true' : undefined}
                        onClick={() => setSelectedWidgetId(widget.id)}
                      >
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <GripVertical className="h-4 w-4" />
                          <span className="w-5 text-center text-xs font-semibold">{index + 1}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{getWallpaperWidgetDisplayTitle(widget, t)}</div>
                          <div className="truncate text-2xs text-muted-foreground">{t(getWallpaperWidgetDefinition(widget.type).title)}</div>
                        </div>
                      </Button>
                      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        {isCoarsePointer ? (
                          <>
                            <IconButton
                              variant="subtle"
                              size="icon-sm"
                              className="touch-none"
                              label={t({ ko: '앞으로 이동', en: 'Move forward' })}
                              tooltip={false}
                              disabled={index === 0}
                              onClick={(event) => {
                                event.stopPropagation()
                                setLayoutPreset((current) => moveWallpaperWidgetToOrder(current, widget.id, index))
                                setSelectedWidgetId(widget.id)
                              }}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              variant="subtle"
                              size="icon-sm"
                              className="touch-none"
                              label={t({ ko: '뒤로 이동', en: 'Move backward' })}
                              tooltip={false}
                              disabled={index === orderedWidgets.length - 1}
                              onClick={(event) => {
                                event.stopPropagation()
                                setLayoutPreset((current) => moveWallpaperWidgetToOrder(current, widget.id, index + 2))
                                setSelectedWidgetId(widget.id)
                              }}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </IconButton>
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
          </Panel>
        </div>

        <section data-surface="raised" className="self-start space-y-4 overflow-y-auto rounded-sm bg-surface-low p-4 xl:sticky xl:top-24 xl:max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)]">
          <div>
            <Heading level={3}>{t({ ko: '위젯 설정', en: 'Widget settings' })}</Heading>
            <div className="mt-1 truncate text-xs text-muted-foreground">{selectedWidget ? getWallpaperWidgetDisplayTitle(selectedWidget, t) : t({ ko: '선택된 위젯 없음', en: 'No widget selected' })}</div>
          </div>

          <WallpaperWidgetInspector
            selectedWidget={selectedWidget}
            groups={groupsQuery.data ?? []}
            onPatchWidget={(widgetId, patch) => {
              setLayoutPreset((current) => patchSelectedWidget(current, widgetId, patch), { coalesceKey: `settings:${widgetId}` })
            }}
          />
        </section>
      </div>

      <WallpaperLivelyHelpModal
        open={isLivelyHelpOpen}
        runtimeUrl={activePresetRuntimeUrl}
        onClose={() => setIsLivelyHelpOpen(false)}
        onCopyRuntimeUrl={() => void handleCopyRuntimeUrl()}
      />
      <WallpaperTemplateModal
        open={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onApply={handleApplyTemplate}
      />
    </div>
  )
}
