import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlignCenterVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BringToFront,
  ClipboardCopy,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  LayoutTemplate,
  Lock,
  LockOpen,
  Magnet,
  MonitorPlay,
  MoreHorizontal,
  Plus,
  Redo2,
  Save,
  SendToBack,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  CalendarClock,
} from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { getGroupsHierarchyAll } from '@/lib/api-groups'
import { getWallpaperRuntimeSettings, updateAppearanceSettings } from '@/lib/api-settings-appearance'
import { copyTextToClipboard } from '@/lib/clipboard'
import { triggerBlobDownload } from '@/lib/api-client'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { getGraphWorkflowSchedules } from '@/lib/api-module-graph'
import { createWallpaperRuntimeToken, listWallpaperRuntimeTokens, revokeWallpaperRuntimeToken } from '@/lib/api-wallpaper-runtime'
import type { ChatPageData } from '@conai/shared'
import { listWallpaperCanvasPresets, WALLPAPER_CUSTOM_CANVAS_ID } from './wallpaper-canvas-presets'
import {
  alignWallpaperWidgets,
  appendWallpaperWidget,
  buildWallpaperDraftRuntimePath,
  buildWallpaperLayoutDraft,
  buildWallpaperRuntimePath,
  buildWallpaperStarterLayout,
  clampWallpaperWidgetInstance,
  cloneWallpaperPresetToDraft,
  deleteWallpaperLayoutPreset,
  distributeWallpaperWidgets,
  duplicateWallpaperWidgets,
  loadWallpaperActivePresetId,
  loadWallpaperLayoutDraft,
  loadWallpaperLayoutPresets,
  normalizeWallpaperBackground,
  normalizeWallpaperLayoutPreset,
  nudgeWallpaperWidgets,
  pasteWallpaperWidgets,
  removeWallpaperWidgets,
  reorderWallpaperWidgets,
  resizeWallpaperLayoutCanvas,
  type WallpaperAlignMode,
  saveWallpaperActivePresetId,
  saveWallpaperLayoutDraft,
  saveWallpaperLayoutPresets,
  setWallpaperWidgetFrames,
  stackWallpaperWidgets,
  toWallpaperLayoutPresetViewModels,
  toWallpaperLayoutPresetWireModel,
  toWallpaperLayoutPresetWireModels,
  upsertWallpaperLayoutPreset,
} from './wallpaper-layout-utils'
import { getWallpaperLayoutCanvas } from './wallpaper-canvas-presets'
import type { WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'
import { WALLPAPER_WIDGET_TYPE_SET } from './wallpaper-types'
import { WallpaperWidgetInspector, type WallpaperWidgetPatch } from './wallpaper-widget-inspector'
import { WallpaperBackgroundInspector } from './wallpaper-background-inspector'
import { WALLPAPER_WIDGET_DRAG_TYPE, WallpaperWidgetLibrarySidebar } from './wallpaper-widget-library-sidebar'
import { WALLPAPER_RUNTIME_TOKENS_QUERY_KEY, WallpaperLivelyConnectModal, wallpaperIssuedKey, type WallpaperIssuedKey } from './wallpaper-lively-connect-modal'
import { WallpaperScheduleModal } from './wallpaper-schedule-modal'
import { WallpaperTemplateModal } from './wallpaper-template-modal'
import { WallpaperStage, type WallpaperStageZoom } from './wallpaper-stage'
import { useUndoableState } from './use-undoable-state'
import { useWallpaperLeaveGuard } from './use-wallpaper-leave-guard'
import { useWallpaperTheme } from './use-wallpaper-theme'
import { buildWallpaperTemplateLayout, WALLPAPER_TEMPLATES, type WallpaperTemplateDefinition, type WallpaperTemplateId } from './wallpaper-templates'
import { WallpaperDataEnvironmentContext } from './wallpaper-widget-data'
import { buildWallpaperPresetFile, parseWallpaperPresetFile } from './wallpaper-preset-file'
import {
  buildWallpaperChatPage,
  patchWallpaperBackground,
  patchWallpaperOptions,
  patchWallpaperWidgetSettings,
  patchWallpaperWidgetStyle,
  readWallpaperPatch,
  readWallpaperSchedule,
  WALLPAPER_LOOK_SCHEMA,
  WALLPAPER_PATCH_HINTS,
  WALLPAPER_SCHEDULE_SCHEMA,
  WALLPAPER_WIDGET_PATCH_SCHEMA,
} from './wallpaper-chat-page'

/** A chat's widget patch (JSON text: frame, visibility, style, settings) written onto one widget; add and update share it. */
function applyChatWidgetPatch(layout: WallpaperLayoutPreset, widgetId: string, raw: ChatPageData | undefined, scheduleNames: Map<number, string>) {
  const widget = layout.widgets.find((item) => item.id === widgetId)
  if (!widget) throw new Error('캔버스에 없는 위젯이야. data.widgets의 id를 써.')
  const args = readWallpaperPatch(raw, WALLPAPER_WIDGET_PATCH_SCHEMA, 'patch', WALLPAPER_PATCH_HINTS.widget)
  const patch: WallpaperWidgetPatch = {}
  for (const key of ['x', 'y', 'w', 'h', 'rotation'] as const) if (typeof args[key] === 'number') patch[key] = args[key] as number
  for (const key of ['hidden', 'locked'] as const) if (typeof args[key] === 'boolean') patch[key] = args[key] as boolean
  if (args.style !== undefined) patch.style = patchWallpaperWidgetStyle(widget, args.style as Record<string, ChatPageData>)
  if (args.settings !== undefined) patch.settings = patchWallpaperWidgetSettings(widget, args.settings as Record<string, ChatPageData>, scheduleNames)
  return patchWidget(layout, widgetId, patch)
}

const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2]
const SNAP_STORAGE_KEY = 'conai.wallpaper.snap'
const EDITOR_ENVIRONMENT = { mode: 'editor' as const, live: false }

function readSnapPreference() {
  try {
    return window.localStorage.getItem(SNAP_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Apply one inspector patch to a widget, merging style and settings and keeping it on the canvas. */
function patchWidget(layout: WallpaperLayoutPreset, widgetId: string, patch: WallpaperWidgetPatch): WallpaperLayoutPreset {
  const canvas = getWallpaperLayoutCanvas(layout)
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => {
      if (widget.id !== widgetId) return widget
      const next = {
        ...widget,
        ...patch,
        style: patch.style ? { ...widget.style, ...patch.style } : widget.style,
        settings: patch.settings ? { ...(widget.settings as object), ...patch.settings } : widget.settings,
      } as WallpaperWidgetInstance
      return clampWallpaperWidgetInstance(next, canvas)
    }),
  }
}

/** What saving persists, normalized so clamping or defaults never read as edits. */
function presetSignature(preset: WallpaperLayoutPreset) {
  const wire = toWallpaperLayoutPresetWireModel(normalizeWallpaperLayoutPreset(preset))
  return JSON.stringify([wire.canvasPresetId, wire.canvasWidth, wire.canvasHeight, wire.themeMode, normalizeWallpaperBackground(wire.background), wire.options ?? null, wire.widgets])
}

export function WallpaperEditorPage() {
  const { isAdmin } = useFeaturePermissions()
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
  } = useUndoableState(() => loadWallpaperLayoutDraft() ?? buildWallpaperStarterLayout('landscape-1080p'), { limit: 80 })
  // A browser without its own draft (new device, cleared storage) opens the server's active preset instead.
  const [startedWithoutDraft] = useState(() => loadWallpaperLayoutDraft() === null)
  const [savedPresets, setSavedPresets] = useState(() => loadWallpaperLayoutPresets())
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadWallpaperActivePresetId())
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [zoom, setZoom] = useState<WallpaperStageZoom>('fit')
  const [zoomPercent, setZoomPercent] = useState(0)
  const [snap, setSnap] = useState(readSnapPreference)
  const [isLivelyOpen, setIsLivelyOpen] = useState(false)
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const workspaceMenuAnchorRef = useRef<HTMLButtonElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const clipboardRef = useRef<WallpaperWidgetInstance[]>([])
  const theme = useWallpaperTheme(layoutPreset.themeMode)
  const queryClient = useQueryClient()
  // A key a connected chat issued through its card: shown once in the Lively dialog, never in the chat.
  const [livelyIssued, setLivelyIssued] = useState<WallpaperIssuedKey | null>(null)

  const notifyInfo = useCallback((message: string) => showSnackbar({ message, tone: 'info' }), [showSnackbar])
  const notifyError = useCallback((message: string) => showSnackbar({ message, tone: 'error' }), [showSnackbar])

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'wallpaper-widget-editor'],
    queryFn: () => getGroupsHierarchyAll(),
    staleTime: 60_000,
  })

  const wallpaperSettingsQuery = useQuery({
    queryKey: ['wallpaper-runtime-settings'],
    queryFn: getWallpaperRuntimeSettings,
    staleTime: 60_000,
  })

  // For a connected chat: issued keys (names only) and the schedules a quick-run widget can press.
  const runtimeKeysQuery = useQuery({
    queryKey: WALLPAPER_RUNTIME_TOKENS_QUERY_KEY,
    queryFn: listWallpaperRuntimeTokens,
    enabled: isAdmin,
    staleTime: 60_000,
  })
  const quickRunSchedulesQuery = useQuery({
    queryKey: ['wallpaper-inspector', 'graph-workflow-schedules'],
    queryFn: () => getGraphWorkflowSchedules(),
    staleTime: 60_000,
    retry: false,
  })

  const wallpaperPresetMutation = useMutation({
    mutationFn: ({ wallpaperLayoutPresets, wallpaperActivePresetId }: { wallpaperLayoutPresets: WallpaperLayoutPreset[]; wallpaperActivePresetId: string | null }) => (
      updateAppearanceSettings({
        wallpaperLayoutPresets: toWallpaperLayoutPresetWireModels(wallpaperLayoutPresets),
        wallpaperActivePresetId,
      })
    ),
  })

  const savedPresetById = useMemo(() => new Map(savedPresets.map((preset) => [preset.id, preset])), [savedPresets])
  const widgetById = useMemo(() => new Map(layoutPreset.widgets.map((widget) => [widget.id, widget])), [layoutPreset.widgets])
  const effectiveActivePresetId = activePresetId && savedPresetById.has(activePresetId) ? activePresetId : null
  const activePreset = effectiveActivePresetId ? (savedPresetById.get(effectiveActivePresetId) ?? null) : null
  const hasUnsavedPresetChanges = useMemo(() => {
    if (!activePreset) return false
    const draftName = layoutPreset.name.trim() || activePreset.name
    return draftName !== activePreset.name || presetSignature(layoutPreset) !== presetSignature(activePreset)
  }, [activePreset, layoutPreset])
  // With a saved preset, only differences from it count. Without one, the draft already lives in this browser,
  // so leaving only warns about edits made in this visit, while replacing the canvas warns whenever it has widgets.
  const hasUnsavedEdits = activePreset ? hasUnsavedPresetChanges : canUndo
  const hasDiscardableEdits = activePreset ? hasUnsavedPresetChanges : layoutPreset.widgets.length > 0
  useWallpaperLeaveGuard(
    hasUnsavedEdits,
    t({ ko: '프리셋에 저장하지 않은 월페이퍼 변경이 있어. 초안은 이 브라우저에 남지만 저장된 월페이퍼에는 반영되지 않아. 나갈까?', en: 'You have wallpaper changes that are not saved to a preset. The draft stays in this browser, but the saved wallpaper does not change. Leave?' }),
  )

  const effectiveSelectedIds = useMemo(() => selectedIds.filter((id) => widgetById.has(id)), [selectedIds, widgetById])
  const selectedWidgets = useMemo(() => effectiveSelectedIds.map((id) => widgetById.get(id)).filter((widget): widget is WallpaperWidgetInstance => Boolean(widget)), [effectiveSelectedIds, widgetById])
  const draftRuntimePath = buildWallpaperDraftRuntimePath()
  const activePresetRuntimePath = activePreset ? buildWallpaperRuntimePath(activePreset) : null

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
    try {
      window.localStorage.setItem(SNAP_STORAGE_KEY, snap ? 'on' : 'off')
    } catch {
      // Private windows: the preference just is not kept.
    }
  }, [snap])

  useEffect(() => {
    if (hasHydratedServerPresetsRef.current || !wallpaperSettingsQuery.data) {
      return
    }

    hasHydratedServerPresetsRef.current = true
    const serverPresets = toWallpaperLayoutPresetViewModels(wallpaperSettingsQuery.data.wallpaperLayoutPresets)
    const serverActivePresetId = wallpaperSettingsQuery.data.wallpaperActivePresetId

    if (serverPresets.length === 0 && serverActivePresetId === null) {
      return
    }

    const serverActivePreset = serverPresets.find((preset) => preset.id === serverActivePresetId) ?? null
    queueMicrotask(() => {
      setSavedPresets(serverPresets)
      setActivePresetId(serverActivePresetId)
      if (startedWithoutDraft && serverActivePreset) resetLayoutPreset(cloneWallpaperPresetToDraft(serverActivePreset))
    })
    saveWallpaperLayoutPresets(serverPresets)
    saveWallpaperActivePresetId(serverActivePresetId)
  }, [resetLayoutPreset, startedWithoutDraft, wallpaperSettingsQuery.data])

  const syncWallpaperPresetState = (
    nextPresets: WallpaperLayoutPreset[],
    nextActivePresetId: string | null,
    successMessage?: string,
  ) => {
    if (!isAdmin) { notifyError(t({ ko: '서버 설정 변경은 관리자 권한이 필요해.', en: 'Changing server settings requires an administrator.' })); return }
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

    setActivePresetId(nextPreset.id)
    resetLayoutPreset(cloneWallpaperPresetToDraft(nextPreset))
    setSelectedIds([])
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
    if (!activePresetRuntimePath) {
      return
    }

    try {
      await copyTextToClipboard(new URL(activePresetRuntimePath, window.location.origin).toString())
      notifyInfo(t({ ko: '월페이퍼 URL을 복사했어. 로그인한 브라우저에서만 열려.', en: 'Copied the wallpaper URL. It opens only in a signed-in browser.' }))
    } catch {
      notifyError(t({ ko: '월페이퍼 URL을 복사하지 못했어.', en: 'Failed to copy the wallpaper URL.' }))
    }
  }

  const handleCreateBlankCanvas = async () => {
    if (!(await confirmDiscardEdits(t({ ko: '새 캔버스', en: 'New canvas' }), t({ ko: '새로 만들기', en: 'Create' })))) {
      return
    }

    const nextLayoutPreset = {
      ...buildWallpaperLayoutDraft(layoutPreset.canvasPresetId),
      canvasWidth: layoutPreset.canvasWidth,
      canvasHeight: layoutPreset.canvasHeight,
    }
    setActivePresetId(null)
    resetLayoutPreset(nextLayoutPreset)
    setSelectedIds([])
    syncWallpaperPresetState(savedPresets, null)
  }

  const handleExportFile = () => {
    const { fileName, blob } = buildWallpaperPresetFile({ ...layoutPreset, name: layoutPreset.name.trim() || activePreset?.name || 'Wallpaper' })
    triggerBlobDownload(blob, fileName)
  }

  const handleImportFile = async (file: File) => {
    const draft = parseWallpaperPresetFile(await file.text())
    if (!draft) {
      notifyError(t({ ko: '월페이퍼 파일이 아니야.', en: 'This is not a wallpaper file.' }))
      return
    }
    if (!(await confirmDiscardEdits(t({ ko: '파일에서 가져오기', en: 'Import from file' }), t({ ko: '가져오기', en: 'Import' })))) {
      return
    }
    setActivePresetId(null)
    resetLayoutPreset(draft)
    setSelectedIds([])
    syncWallpaperPresetState(savedPresets, null)
    notifyInfo(t({ ko: "'{name}'을 새 캔버스로 가져왔어. 저장하면 프리셋이 돼.", en: "Imported '{name}' as a new canvas. Save it to make a preset." }, { name: draft.name }))
  }

  const addWidget = (widgetType: WallpaperWidgetType, center?: { x: number; y: number }) => {
    const { layout, widgetId } = appendWallpaperWidget(layoutPreset, widgetType, center)
    setLayoutPreset(layout)
    setSelectedIds([widgetId])
  }

  const handleChangeCanvas = (canvasPresetId: string, custom?: { width: number; height: number }) => {
    setLayoutPreset((current) => resizeWallpaperLayoutCanvas(current, canvasPresetId, custom), { coalesceKey: 'canvas' })
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

    const canvas = getWallpaperLayoutCanvas(layoutPreset)
    const nextLayout = buildWallpaperTemplateLayout(template.id, layoutPreset.canvasPresetId, t(template.name), { width: canvas.width, height: canvas.height })
    setActivePresetId(null)
    resetLayoutPreset(nextLayout)
    setSelectedIds([])
    setIsTemplateModalOpen(false)
    syncWallpaperPresetState(savedPresets, null)
  }

  const removeSelection = useCallback(() => {
    if (effectiveSelectedIds.length === 0) return
    setLayoutPreset((current) => removeWallpaperWidgets(current, effectiveSelectedIds))
    setSelectedIds([])
  }, [effectiveSelectedIds, setLayoutPreset])

  const duplicateSelection = useCallback(() => {
    if (effectiveSelectedIds.length === 0) return
    const result = duplicateWallpaperWidgets(layoutPreset, effectiveSelectedIds)
    setLayoutPreset(result.layout)
    setSelectedIds(result.widgetIds)
  }, [effectiveSelectedIds, layoutPreset, setLayoutPreset])

  const toggleLockSelection = useCallback(() => {
    const lock = !selectedWidgets.every((widget) => widget.locked)
    const ids = new Set(effectiveSelectedIds)
    setLayoutPreset((current) => ({ ...current, widgets: current.widgets.map((widget) => (ids.has(widget.id) ? { ...widget, locked: lock } : widget)) }))
  }, [effectiveSelectedIds, selectedWidgets, setLayoutPreset])

  const stepZoom = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? zoomPercent / 100 : zoom
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001)
    if (next) setZoom(next)
  }

  // Keyboard: undo/redo, delete, nudge, duplicate, copy/paste, select all, layer order.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return
      }
      if (document.querySelector('[role="dialog"]')) {
        return
      }
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (mod && !event.altKey) {
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); undoLayoutEdit(); return }
        if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); redoLayoutEdit(); return }
        if (key === 'a') { event.preventDefault(); setSelectedIds(layoutPreset.widgets.map((widget) => widget.id)); return }
        if (key === 'd') { event.preventDefault(); duplicateSelection(); return }
        if (key === 'c' && selectedWidgets.length > 0) { clipboardRef.current = structuredClone(selectedWidgets); return }
        if (key === 'v' && clipboardRef.current.length > 0) {
          event.preventDefault()
          const result = pasteWallpaperWidgets(layoutPreset, clipboardRef.current.map((widget) => ({ ...widget, x: widget.x + 24, y: widget.y + 24 })))
          clipboardRef.current = result.layout.widgets.filter((widget) => result.widgetIds.includes(widget.id))
          setLayoutPreset(result.layout)
          setSelectedIds(result.widgetIds)
          return
        }
        if (key === ']' || key === '[') {
          event.preventDefault()
          setLayoutPreset((current) => stackWallpaperWidgets(current, effectiveSelectedIds, key === ']' ? 'front' : 'back'))
          return
        }
      }

      if (event.key === 'Escape') { setSelectedIds([]); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && effectiveSelectedIds.length > 0) { event.preventDefault(); removeSelection(); return }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      if (arrows[event.key] && effectiveSelectedIds.length > 0) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const [dx, dy] = arrows[event.key]
        setLayoutPreset((current) => nudgeWallpaperWidgets(current, effectiveSelectedIds, { x: dx * step, y: dy * step }), { coalesceKey: `nudge:${effectiveSelectedIds.join(',')}` })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [duplicateSelection, effectiveSelectedIds, layoutPreset, redoLayoutEdit, removeSelection, selectedWidgets, setLayoutPreset, undoLayoutEdit])

  // A connected chat reads the whole draft and edits it (draft operations the person can undo); saving, deleting a
  // preset, the schedule and runtime keys go through a card. A key it issues is shown only in the Lively dialog.
  const layoutRef = useRef(layoutPreset)
  layoutRef.current = layoutPreset
  const scheduleNames = new Map((quickRunSchedulesQuery.data ?? []).map((schedule) => [schedule.id, schedule.name]))
  const runtimeKeys = isAdmin ? (runtimeKeysQuery.data ?? []) : []
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  const chatPage = buildWallpaperChatPage({
    t,
    layout: layoutPreset,
    canvas,
    selectedIds: effectiveSelectedIds,
    saveTo: activePreset?.name ?? '',
    canUndo,
    canRedo,
    savedPresets,
    activePresetId: effectiveActivePresetId,
    schedule: wallpaperSettingsQuery.data?.wallpaperSchedule,
    runtimeKeys,
    quickRunSchedules: (quickRunSchedulesQuery.data ?? []).map((schedule) => ({ id: schedule.id, name: schedule.name })),
    isAdmin,
  })
  const requireWidgetIds = (value: ChatPageData | undefined) => {
    const ids = (Array.isArray(value) ? value : [value]).map(String)
    const missing = ids.filter((widgetId) => !layoutRef.current.widgets.some((widget) => widget.id === widgetId))
    if (missing.length) throw new Error(`캔버스에 없는 위젯이야: ${missing.join(', ')}. data.widgets의 id를 써.`)
    return ids
  }
  const requirePresetId = (value: ChatPageData | undefined) => {
    const presetId = String(value ?? '')
    if (!savedPresetById.has(presetId)) throw new Error('저장된 배경화면이 아니야. data.savedWallpapers의 id를 써.')
    return presetId
  }
  /** Run one draft edit and hand back its undo while the canvas still holds it. */
  const draftEdit = (next: WallpaperLayoutPreset, selection?: string[]) => {
    const before = layoutRef.current
    setLayoutPreset(next)
    if (selection) setSelectedIds(selection)
    return { isCurrent: () => JSON.stringify(layoutRef.current) === JSON.stringify(next), restore: () => setLayoutPreset(before) }
  }
  /** Replace the whole draft (template, new canvas) without touching the server's active wallpaper. */
  const replaceDraft = (next: WallpaperLayoutPreset) => {
    const before = layoutRef.current
    const beforeActive = activePresetId
    setActivePresetId(null)
    resetLayoutPreset(next)
    setSelectedIds([])
    return { isCurrent: () => JSON.stringify(layoutRef.current) === JSON.stringify(next), restore: () => { resetLayoutPreset(before); setActivePresetId(beforeActive) } }
  }
  useChatPageRegistration({
    kind: 'wallpaper', title: t({ ko: '배경화면 편집', en: 'Wallpaper editor' }), resourceId: layoutPreset.id, localRevision: JSON.stringify(layoutPreset),
    dirty: hasUnsavedEdits,
    ...chatPage,
    apply: (patch) => setLayoutPreset(normalizeWallpaperLayoutPreset({ ...layoutPreset, ...patch } as typeof layoutPreset)),
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      const current = layoutRef.current
      const ids = args.widgetIds === undefined ? [] : requireWidgetIds(args.widgetIds)
      switch (id) {
        case 'wallpaper.select': setSelectedIds(requireWidgetIds(args.widgetId)); return
        case 'wallpaper.open_preset':
          if (hasDiscardableEdits) throw new Error('편집 중인 배경화면이 저장되지 않았어. 사용자가 저장하거나 버린 뒤에 다시 해.')
          await handleLoadPreset(requirePresetId(args.presetId))
          return
        case 'wallpaper.add_widget': {
          const { layout, widgetId } = appendWallpaperWidget(current, String(args.type) as WallpaperWidgetType)
          return draftEdit(args.patch ? applyChatWidgetPatch(layout, widgetId, args.patch, scheduleNames) : layout, [widgetId])
        }
        case 'wallpaper.update_widget': {
          const [target] = requireWidgetIds(args.widgetId)
          return draftEdit(applyChatWidgetPatch(current, target, args.patch, scheduleNames), [target])
        }
        case 'wallpaper.arrange': {
          const op = String(args.op)
          if (op === 'remove') return draftEdit(removeWallpaperWidgets(current, ids), [])
          if (op === 'duplicate') { const result = duplicateWallpaperWidgets(current, ids); return draftEdit(result.layout, result.widgetIds) }
          if (op === 'front' || op === 'back') return draftEdit(stackWallpaperWidgets(current, ids, op))
          if (op.startsWith('distribute-')) return draftEdit(distributeWallpaperWidgets(current, ids, op.endsWith('x') ? 'x' : 'y'))
          return draftEdit(alignWallpaperWidgets(current, ids, op.slice('align-'.length) as WallpaperAlignMode))
        }
        case 'wallpaper.apply_template': {
          const template = WALLPAPER_TEMPLATES.find((item) => item.id === args.templateId)
          if (!template) throw new Error('없는 템플릿이야. data.templates의 id를 써.')
          const size = getWallpaperLayoutCanvas(current)
          return replaceDraft(buildWallpaperTemplateLayout(template.id as WallpaperTemplateId, current.canvasPresetId, t(template.name), { width: size.width, height: size.height }))
        }
        case 'wallpaper.set_look': {
          const look = readWallpaperPatch(args.patch, WALLPAPER_LOOK_SCHEMA, 'patch', WALLPAPER_PATCH_HINTS.look)
          const next = { ...current }
          if (look.background !== undefined) next.background = patchWallpaperBackground(current.background, look.background as Record<string, ChatPageData>)
          if (look.options !== undefined) {
            const { options, themeMode } = patchWallpaperOptions(current.options, look.options as Record<string, ChatPageData>)
            next.options = options
            if (themeMode) next.themeMode = themeMode
          }
          return draftEdit(next)
        }
        case 'wallpaper.set_canvas': {
          const presetId = String(args.canvasPresetId)
          const size = getWallpaperLayoutCanvas(current)
          const custom = presetId === WALLPAPER_CUSTOM_CANVAS_ID ? { width: typeof args.width === 'number' ? args.width : size.width, height: typeof args.height === 'number' ? args.height : size.height } : undefined
          return draftEdit(resizeWallpaperLayoutCanvas(current, presetId, custom))
        }
        case 'wallpaper.history':
          if (args.step === 'new') return replaceDraft({ ...buildWallpaperLayoutDraft(current.canvasPresetId), canvasWidth: current.canvasWidth, canvasHeight: current.canvasHeight })
          if (args.step === 'redo') { if (!canRedo) throw new Error('다시 실행할 변경이 없어.'); redoLayoutEdit() }
          else { if (!canUndo) throw new Error('실행 취소할 변경이 없어.'); undoLayoutEdit() }
          return
        case 'wallpaper.open_dialog':
          if (args.dialog === 'templates') { setIsTemplateModalOpen(true); return }
          if (args.dialog === 'export') { handleExportFile(); return }
          if (!isAdmin) throw new Error('관리자만 열 수 있어.')
          if (args.dialog === 'schedule') {
            if (savedPresets.length === 0 || !wallpaperSettingsQuery.data) throw new Error('저장된 배경화면이 있어야 일정을 정할 수 있어.')
            setIsScheduleOpen(true)
            return
          }
          setLivelyIssued(null)
          setIsLivelyOpen(true)
          return
        case 'wallpaper.save': handleSavePreset({ saveAsNew: args.asNew === true }); return
        case 'wallpaper.delete_preset': {
          const presetId = requirePresetId(args.presetId)
          syncWallpaperPresetState(deleteWallpaperLayoutPreset(savedPresets, presetId), presetId === effectiveActivePresetId ? null : effectiveActivePresetId, t({ ko: '프리셋을 삭제했어.', en: 'Deleted the preset.' }))
          return
        }
        case 'wallpaper.save_schedule':
          await updateAppearanceSettings({ wallpaperSchedule: readWallpaperSchedule(readWallpaperPatch({ enabled: args.enabled, entries: args.entries }, WALLPAPER_SCHEDULE_SCHEMA(savedPresets.map((preset) => preset.id)), 'schedule')) })
          await queryClient.invalidateQueries({ queryKey: ['wallpaper-runtime-settings'] })
          notifyInfo(t({ ko: '일정을 저장했어.', en: 'Saved the schedule.' }))
          return
        case 'wallpaper.issue_key': {
          const name = String(args.name).trim()
          if (!name) throw new Error('기기 이름이 필요해.')
          const token = await createWallpaperRuntimeToken({ name, presetId: args.presetId ? requirePresetId(args.presetId) : null })
          setLivelyIssued(wallpaperIssuedKey(token, savedPresets, effectiveActivePresetId))
          setIsLivelyOpen(true)
          void queryClient.invalidateQueries({ queryKey: WALLPAPER_RUNTIME_TOKENS_QUERY_KEY })
          return
        }
        case 'wallpaper.revoke_key':
          await revokeWallpaperRuntimeToken(Number(args.keyId))
          await queryClient.invalidateQueries({ queryKey: WALLPAPER_RUNTIME_TOKENS_QUERY_KEY })
          return
        default: throw new Error('배경화면 편집기에 없는 작업이야.')
      }
    },
  })

  const unsavedLabel = t({ ko: '저장 안 된 변경', en: 'Unsaved changes' })
  const allSelectedLocked = selectedWidgets.length > 0 && selectedWidgets.every((widget) => widget.locked)
  const toolbar = (
    <PageToolbar
      start={(
        <Select
          aria-label={t({ ko: '프리셋', en: 'Preset' })}
          className="h-8 w-44 sm:w-52"
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
      )}
      actions={(
        <>
          <IconButton variant="ghost" size="icon-sm" onClick={() => setIsTemplateModalOpen(true)} label={t({ ko: '템플릿', en: 'Templates' })}>
            <LayoutTemplate />
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undoLayoutEdit} label={t({ ko: '실행 취소 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' })}>
            <Undo2 />
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redoLayoutEdit} label={t({ ko: '다시 실행 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' })}>
            <Redo2 />
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" active={snap} aria-pressed={snap} onClick={() => setSnap((current) => !current)} label={snap ? t({ ko: '스냅 켜짐 (Alt 누르면 잠시 끔)', en: 'Snap on (hold Alt to bypass)' }) : t({ ko: '스냅 꺼짐', en: 'Snap off' })}>
            <Magnet />
          </IconButton>
          <div className="flex items-center">
            <IconButton variant="ghost" size="icon-sm" onClick={() => stepZoom(-1)} label={t({ ko: '축소', en: 'Zoom out' })}>
              <ZoomOut />
            </IconButton>
            <Button type="button" variant="ghost" size="sm" className="h-8 min-w-12 px-1 font-mono text-xs tabular-nums" onClick={() => setZoom('fit')} aria-label={t({ ko: '화면에 맞추기', en: 'Fit to screen' })} title={t({ ko: '화면에 맞추기', en: 'Fit to screen' })}>
              {zoomPercent}%
            </Button>
            <IconButton variant="ghost" size="icon-sm" onClick={() => stepZoom(1)} label={t({ ko: '확대', en: 'Zoom in' })}>
              <ZoomIn />
            </IconButton>
          </div>
          <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '실행 미리보기', en: 'Live preview' })}>
            <a href={draftRuntimePath} target="_blank" rel="noreferrer">
              <Eye />
            </a>
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={!isAdmin} onClick={() => setIsLivelyOpen(true)} label={t({ ko: 'Lively 연결', en: 'Connect Lively' })}>
            <MonitorPlay />
          </IconButton>
          <IconButton
            ref={workspaceMenuAnchorRef}
            variant="ghost"
            size="icon-sm"
            label={t({ ko: '더 많은 작업', en: 'More actions' })}
            aria-expanded={isWorkspaceMenuOpen}
            onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
          >
            <MoreHorizontal />
          </IconButton>
          {activePreset && hasUnsavedPresetChanges ? (
            <span className="ml-1 size-2 shrink-0 rounded-full bg-primary" role="status" aria-label={unsavedLabel} title={unsavedLabel} />
          ) : null}
          <IconButton variant="default" size="icon-sm" className="ml-1" disabled={!isAdmin || wallpaperPresetMutation.isPending} onClick={() => handleSavePreset()} aria-busy={wallpaperPresetMutation.isPending || undefined} label={t({ ko: '저장', en: 'Save' })}>
            <Save />
          </IconButton>
        </>
      )}
    >
      <Input
        aria-label={t({ ko: '이름', en: 'Name' })}
        placeholder={t({ ko: '이름', en: 'Name' })}
        className="h-8 min-w-0 flex-1 sm:max-w-64"
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
      <Select
        aria-label={t({ ko: '캔버스', en: 'Canvas' })}
        className="h-8 w-40 shrink-0"
        value={layoutPreset.canvasPresetId}
        onChange={(event) => handleChangeCanvas(event.target.value, event.target.value === WALLPAPER_CUSTOM_CANVAS_ID ? { width: getWallpaperLayoutCanvas(layoutPreset).width, height: getWallpaperLayoutCanvas(layoutPreset).height } : undefined)}
      >
        {listWallpaperCanvasPresets().map((preset) => (
          <option key={preset.id} value={preset.id}>{preset.name} · {preset.aspectRatioLabel}</option>
        ))}
        <option value={WALLPAPER_CUSTOM_CANVAS_ID}>{t({ ko: '직접 입력', en: 'Custom' })}</option>
      </Select>
    </PageToolbar>
  )

  const selectionToolbar = selectedWidgets.length > 0 ? (
    <>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '복제 (Ctrl+D)', en: 'Duplicate (Ctrl+D)' })} onClick={duplicateSelection}><CopyPlus /></IconButton>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '왼쪽 정렬', en: 'Align left' })} onClick={() => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'left'))}><AlignStartVertical /></IconButton>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '가운데 정렬', en: 'Center' })} onClick={() => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'hcenter'))}><AlignCenterVertical /></IconButton>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '위 정렬', en: 'Align top' })} onClick={() => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'top'))}><AlignStartHorizontal /></IconButton>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '맨 앞으로 (Ctrl+])', en: 'Bring to front (Ctrl+])' })} onClick={() => setLayoutPreset((current) => stackWallpaperWidgets(current, effectiveSelectedIds, 'front'))}><BringToFront /></IconButton>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '맨 뒤로 (Ctrl+[)', en: 'Send to back (Ctrl+[)' })} onClick={() => setLayoutPreset((current) => stackWallpaperWidgets(current, effectiveSelectedIds, 'back'))}><SendToBack /></IconButton>
      <IconButton variant="ghost" size="icon-xs" active={allSelectedLocked} label={allSelectedLocked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' })} onClick={toggleLockSelection}>{allSelectedLocked ? <Lock /> : <LockOpen />}</IconButton>
      <IconButton variant="ghost" size="icon-xs" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" label={t({ ko: '삭제 (Delete)', en: 'Delete (Delete)' })} onClick={removeSelection}><Trash2 /></IconButton>
    </>
  ) : null

  return (
    <WallpaperDataEnvironmentContext.Provider value={EDITOR_ENVIRONMENT}>
      <PageWithSidebar
        storageKey="wallpaper"
        sidebar={(
          <WallpaperWidgetLibrarySidebar
            widgets={layoutPreset.widgets}
            selectedIds={effectiveSelectedIds}
            onAddWidget={(type) => addWidget(type)}
            onSelect={setSelectedIds}
            onReorder={(ids) => setLayoutPreset((current) => reorderWallpaperWidgets(current, ids))}
            onToggleHidden={(widget) => setLayoutPreset((current) => patchWidget(current, widget.id, { hidden: !widget.hidden }))}
            onToggleLocked={(widget) => setLayoutPreset((current) => patchWidget(current, widget.id, { locked: !widget.locked }))}
          />
        )}
        sidebarLabel={t({ ko: '위젯 라이브러리', en: 'Widget library' })}
        toolbar={toolbar}
      >
        <AnchoredPopup
          open={isWorkspaceMenuOpen}
          anchorRef={workspaceMenuAnchorRef}
          onClose={() => setIsWorkspaceMenuOpen(false)}
          className="w-64 p-2"
        >
          {[
            { icon: Plus, label: t({ ko: '새 캔버스', en: 'New canvas' }), disabled: false, action: () => void handleCreateBlankCanvas() },
            { icon: Copy, label: t({ ko: '다른 이름으로 저장', en: 'Save as new' }), disabled: !isAdmin || wallpaperPresetMutation.isPending, action: () => handleSavePreset({ saveAsNew: true }) },
            { icon: Download, label: t({ ko: '파일로 내보내기', en: 'Export to file' }), disabled: false, action: handleExportFile },
            { icon: Upload, label: t({ ko: '파일에서 가져오기', en: 'Import from file' }), disabled: false, action: () => importInputRef.current?.click() },
            { icon: CalendarClock, label: t({ ko: '시간대별 월페이퍼', en: 'Wallpaper schedule' }), disabled: !isAdmin || savedPresets.length === 0 || !wallpaperSettingsQuery.data, action: () => setIsScheduleOpen(true) },
            { icon: ClipboardCopy, label: t({ ko: '월페이퍼 URL 복사', en: 'Copy wallpaper URL' }), disabled: !activePresetRuntimePath, action: () => void handleCopyRuntimeUrl() },
            { icon: ExternalLink, label: t({ ko: '저장 월페이퍼 열기', en: 'Open saved wallpaper' }), disabled: !activePresetRuntimePath, action: () => activePresetRuntimePath && window.open(activePresetRuntimePath, '_blank', 'noopener,noreferrer') },
            { icon: Trash2, label: t({ ko: '프리셋 삭제', en: 'Delete preset' }), disabled: !isAdmin || !activePreset || wallpaperPresetMutation.isPending, action: handleDeletePreset, destructive: true },
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
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleImportFile(file)
          }}
        />

        <div className="grid gap-6 pt-2 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-0">
          <div className="min-w-0 xl:pr-6">
            <div className="h-[min(78dvh,calc(100dvh-var(--theme-shell-header-height)-8rem))] min-h-[320px] rounded-md bg-fill">
              <WallpaperStage
                layout={layoutPreset}
                mode="editor"
                zoom={zoom}
                onZoomPercentChange={setZoomPercent}
                selectedIds={effectiveSelectedIds}
                onSelectionChange={setSelectedIds}
                onCommitFrames={(frames) => setLayoutPreset((current) => setWallpaperWidgetFrames(current, frames))}
                snap={snap}
                themeClassName={theme.className}
                themeStyle={theme.style}
                selectionToolbar={selectionToolbar}
                emptyHint={t({ ko: '왼쪽에서 위젯을 끌어다 놓거나 눌러서 추가해.', en: 'Drag a widget from the left, or click one to add it.' })}
                dropType={WALLPAPER_WIDGET_DRAG_TYPE}
                onDropWidget={(type, point) => {
                  if (WALLPAPER_WIDGET_TYPE_SET.has(type)) addWidget(type as WallpaperWidgetType, point)
                }}
              />
            </div>
          </div>

          {/* Inspector: a right column split from the canvas by one hairline (stacks under it below xl). */}
          <aside
            aria-label={t({ ko: '위젯 설정', en: 'Widget settings' })}
            className="min-w-0 self-start xl:sticky xl:top-(--theme-shell-header-height) xl:max-h-[calc(100dvh-var(--theme-shell-header-height))] xl:overflow-y-auto xl:border-l xl:border-line xl:pt-2 xl:pb-6 xl:pl-6"
          >
            {selectedWidgets.length > 0 ? (
              <WallpaperWidgetInspector
                selectedWidgets={selectedWidgets}
                groups={groupsQuery.data ?? []}
                onPatchWidget={(widgetId, patch, key) => setLayoutPreset((current) => patchWidget(current, widgetId, patch), { coalesceKey: key })}
                onAlign={(mode) => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, mode))}
                onDistribute={(axis) => setLayoutPreset((current) => distributeWallpaperWidgets(current, effectiveSelectedIds, axis))}
              />
            ) : (
              <WallpaperBackgroundInspector
                layout={layoutPreset}
                groups={groupsQuery.data ?? []}
                onChangeBackground={(background, key) => setLayoutPreset((current) => ({ ...current, background }), { coalesceKey: key })}
                onChangeCanvas={handleChangeCanvas}
                onChangeThemeMode={(themeMode) => setLayoutPreset((current) => ({ ...current, themeMode }))}
                onChangeOptions={(options, key) => setLayoutPreset((current) => ({ ...current, options }), { coalesceKey: key })}
              />
            )}
          </aside>
        </div>

        {isLivelyOpen ? (
          <WallpaperLivelyConnectModal
            key={livelyIssued?.url ?? 'lively'}
            open
            onClose={() => { setIsLivelyOpen(false); setLivelyIssued(null) }}
            presets={savedPresets}
            activePresetId={effectiveActivePresetId}
            initialIssued={livelyIssued}
          />
        ) : null}
        {isScheduleOpen ? (
          <WallpaperScheduleModal
            onClose={() => setIsScheduleOpen(false)}
            presets={savedPresets}
            schedule={wallpaperSettingsQuery.data?.wallpaperSchedule}
          />
        ) : null}
        <WallpaperTemplateModal
          open={isTemplateModalOpen}
          onClose={() => setIsTemplateModalOpen(false)}
          onApply={handleApplyTemplate}
        />
      </PageWithSidebar>
    </WallpaperDataEnvironmentContext.Provider>
  )
}
