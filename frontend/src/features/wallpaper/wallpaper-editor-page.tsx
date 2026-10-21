import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
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
  Radio,
  ArrowDown,
  ArrowUp,
  BoxSelect,
  ClipboardPaste,
  EyeOff,
  Maximize,
  PaintRoller,
  Paintbrush,
  Scan,
  Scissors,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { Button } from '@/components/ui/button'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { getGroupsHierarchyAll, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import { getWallpaperRuntimeSettings, updateAppearanceSettings } from '@/lib/api-settings-appearance'
import { copyTextToClipboard } from '@/lib/clipboard'
import { isTypingTarget } from '@/lib/keyboard-shortcut'
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
  getWallpaperCopyOffset,
  removeWallpaperWidgets,
  reorderWallpaperWidgets,
  resizeWallpaperLayoutCanvas,
  type WallpaperAlignMode,
  saveWallpaperActivePresetId,
  saveWallpaperLayoutDraft,
  saveWallpaperLayoutPresets,
  setWallpaperWidgetFrames,
  stackWallpaperWidgets,
  stepWallpaperWidgets,
  toWallpaperLayoutPresetViewModels,
  toWallpaperLayoutPresetWireModel,
  toWallpaperLayoutPresetWireModels,
  upsertWallpaperLayoutPreset,
  WALLPAPER_HEX_COLOR,
} from './wallpaper-layout-utils'
import { getWallpaperLayoutCanvas } from './wallpaper-canvas-presets'
import type { WallpaperLayoutPreset, WallpaperWidgetFrame, WallpaperWidgetInstance, WallpaperWidgetStyle, WallpaperWidgetType } from './wallpaper-types'
import { WALLPAPER_WIDGET_TYPE_SET } from './wallpaper-types'
import { WallpaperWidgetInspector, type WallpaperWidgetPatch } from './wallpaper-widget-inspector'
import { WallpaperBackgroundInspector } from './wallpaper-background-inspector'
import { WallpaperColorPaletteContext } from './wallpaper-color-picker'
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
const WIDGET_CLIPBOARD_KEY = 'conai.wallpaper.clipboard.widgets'
const STYLE_CLIPBOARD_KEY = 'conai.wallpaper.clipboard.style'

/** Copied widgets and styles last for the tab session, so a reload or another preset can still paste them. */
function readEditorClipboard<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeEditorClipboard(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked; the copy still works until the tab reloads.
  }
}
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
  return patchWidgets(layout, [widgetId], patch)
}

/** The same patch onto several widgets at once (a multi-selection edit is one undo step). */
function patchWidgets(layout: WallpaperLayoutPreset, widgetIds: readonly string[], patch: WallpaperWidgetPatch): WallpaperLayoutPreset {
  const canvas = getWallpaperLayoutCanvas(layout)
  const targets = new Set(widgetIds)
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => {
      if (!targets.has(widget.id)) return widget
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

/** Distinct colors set anywhere in the layout (widgets, background, options), most used first. */
function collectLayoutColors(layout: WallpaperLayoutPreset): string[] {
  const counts = new Map<string, number>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !WALLPAPER_HEX_COLOR.test(value)) return
    const color = value.toLowerCase()
    counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  for (const widget of layout.widgets) {
    add(widget.style.backgroundColor)
    add(widget.style.textColor)
    add(widget.style.accentColor)
    add((widget.settings as { color?: unknown }).color)
  }
  const background = layout.background as unknown as Record<string, unknown>
  add(background.color)
  add(background.from)
  add(background.to)
  add(layout.options?.accentColor)
  add(layout.options?.textColor)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, 16)
}

/** What saving persists, normalized so clamping or defaults never read as edits. */
function presetSignature(preset: WallpaperLayoutPreset) {
  const wire = toWallpaperLayoutPresetWireModel(normalizeWallpaperLayoutPreset(preset))
  return JSON.stringify([wire.canvasPresetId, wire.canvasWidth, wire.canvasHeight, wire.themeMode, normalizeWallpaperBackground(wire.background), wire.options ?? null, wire.widgets])
}

type EditorMenuItem = 'separator' | {
  icon: ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  disabled?: boolean
  destructive?: boolean
  action: () => void
}

/** Rows of a canvas menu (right click, zoom): icon, label and the matching shortcut. */
function EditorMenuItems({ items, onDone }: { items: EditorMenuItem[]; onDone: () => void }) {
  return (
    <div role="menu" className="flex flex-col p-2">
      {items.map((item, index) => (item === 'separator' ? (
        <div key={`separator-${index}`} role="separator" className="mx-1 my-1 h-px bg-line" />
      ) : (
        <Button
          key={item.label}
          type="button"
          role="menuitem"
          variant={item.destructive ? 'destructive-ghost' : 'nav'}
          size="sm"
          disabled={item.disabled}
          className="w-full justify-start"
          onClick={() => {
            onDone()
            item.action()
          }}
        >
          <item.icon className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
          {item.shortcut ? <span className="shrink-0 font-mono text-2xs text-muted-foreground">{item.shortcut}</span> : null}
        </Button>
      )))}
    </div>
  )
}

export function WallpaperEditorPage() {
  const { isAdmin } = useFeaturePermissions()
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar, closeSnackbar } = useSnackbar()
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
  // The preset being edited (this browser) and the one the live wallpaper shows (server) are separate:
  // opening, saving or replacing the draft never moves the live wallpaper; only "make live" does.
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadWallpaperActivePresetId())
  const [livePresetId, setLivePresetId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [zoom, setZoom] = useState<WallpaperStageZoom>('fit')
  const [zoomPercent, setZoomPercent] = useState(0)
  const [snap, setSnap] = useState(readSnapPreference)
  const [isLivelyOpen, setIsLivelyOpen] = useState(false)
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const workspaceMenuAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{ widgetId: string | null; x: number; y: number } | null>(null)
  const contextMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false)
  const zoomMenuAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [zoomDraft, setZoomDraft] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ frame: WallpaperWidgetFrame; nonce: number } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const clipboardRef = useRef<WallpaperWidgetInstance[]>(readEditorClipboard<WallpaperWidgetInstance[]>(WIDGET_CLIPBOARD_KEY) ?? [])
  const [styleClipboard, setStyleClipboard] = useState<Partial<WallpaperWidgetStyle> | null>(() => readEditorClipboard(STYLE_CLIPBOARD_KEY))
  const theme = useWallpaperTheme(layoutPreset.themeMode)
  const queryClient = useQueryClient()
  // A key a connected chat issued through its card: shown once in the Lively dialog, never in the chat.
  const [livelyIssued, setLivelyIssued] = useState<WallpaperIssuedKey | null>(null)

  const notifyInfo = useCallback((message: string) => showSnackbar({ message, tone: 'info' }), [showSnackbar])
  const notifyError = useCallback((message: string) => showSnackbar({ message, tone: 'error' }), [showSnackbar])

  const groupsQuery = useQuery({
    queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY,
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
    // `wallpaperActivePresetId` undefined leaves the server's live wallpaper as it is.
    mutationFn: ({ wallpaperLayoutPresets, wallpaperActivePresetId }: { wallpaperLayoutPresets: WallpaperLayoutPreset[]; wallpaperActivePresetId?: string | null }) => (
      updateAppearanceSettings({
        wallpaperLayoutPresets: toWallpaperLayoutPresetWireModels(wallpaperLayoutPresets),
        ...(wallpaperActivePresetId === undefined ? {} : { wallpaperActivePresetId }),
      })
    ),
  })

  const savedPresetById = useMemo(() => new Map(savedPresets.map((preset) => [preset.id, preset])), [savedPresets])
  const widgetById = useMemo(() => new Map(layoutPreset.widgets.map((widget) => [widget.id, widget])), [layoutPreset.widgets])
  const effectiveActivePresetId = activePresetId && savedPresetById.has(activePresetId) ? activePresetId : null
  const activePreset = effectiveActivePresetId ? (savedPresetById.get(effectiveActivePresetId) ?? null) : null
  // With no live choice the runtime page shows the first saved preset, so the badge does too.
  const effectiveLivePresetId = livePresetId && savedPresetById.has(livePresetId) ? livePresetId : (savedPresets[0]?.id ?? null)
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
  const layoutPalette = useMemo(() => collectLayoutColors(layoutPreset), [layoutPreset])
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
    // Keep editing what this browser had open when the server still has it; otherwise open the live one.
    const editingPresetId = startedWithoutDraft || !serverPresets.some((preset) => preset.id === activePresetId) ? serverActivePresetId : activePresetId
    queueMicrotask(() => {
      setSavedPresets(serverPresets)
      setActivePresetId(editingPresetId)
      if (startedWithoutDraft && serverActivePreset) resetLayoutPreset(cloneWallpaperPresetToDraft(serverActivePreset))
    })
    saveWallpaperLayoutPresets(serverPresets)
    saveWallpaperActivePresetId(editingPresetId)
  }, [activePresetId, resetLayoutPreset, startedWithoutDraft, wallpaperSettingsQuery.data])

  // The live wallpaper follows the server, including changes made from another browser.
  useEffect(() => {
    const serverLivePresetId = wallpaperSettingsQuery.data?.wallpaperActivePresetId
    if (serverLivePresetId !== undefined) queueMicrotask(() => setLivePresetId(serverLivePresetId))
  }, [wallpaperSettingsQuery.data?.wallpaperActivePresetId])

  /** Write the saved presets; `nextLivePresetId` undefined keeps the live wallpaper where it is. */
  const syncWallpaperPresetState = (
    nextPresets: WallpaperLayoutPreset[],
    nextLivePresetId: string | null | undefined,
    successMessage?: string,
  ) => {
    if (!isAdmin) { notifyError(t({ ko: '서버 설정 변경은 관리자 권한이 필요해.', en: 'Changing server settings requires an administrator.' })); return }
    wallpaperPresetMutation.mutate(
      {
        wallpaperLayoutPresets: nextPresets,
        wallpaperActivePresetId: nextLivePresetId,
      },
      {
        onSuccess: (settings) => {
          setSavedPresets(toWallpaperLayoutPresetViewModels(settings.appearance.wallpaperLayoutPresets))
          setLivePresetId(settings.appearance.wallpaperActivePresetId)
          void queryClient.invalidateQueries({ queryKey: ['wallpaper-runtime-settings'] })
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

  /**
   * Swap the whole canvas (open a preset, new canvas, template, import). The undo history starts over because its
   * steps belong to the old canvas, so the snackbar offers one step back to it instead.
   */
  const replaceCanvas = (next: WallpaperLayoutPreset, nextPresetId: string | null, message: string) => {
    const before = layoutPreset
    const beforePresetId = activePresetId
    setActivePresetId(nextPresetId)
    resetLayoutPreset(next)
    setSelectedIds([])
    showSnackbar({
      key: 'wallpaper-canvas-replaced',
      message,
      durationMs: 8000,
      content: (
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1">{message}</span>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="shrink-0"
            onClick={() => {
              setActivePresetId(beforePresetId)
              resetLayoutPreset(before)
              setSelectedIds([])
              closeSnackbar()
            }}
          >
            {t({ ko: '되돌리기', en: 'Undo' })}
          </Button>
        </span>
      ),
    })
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
      return
    }

    const nextPreset = savedPresetById.get(presetId)
    if (!nextPreset) {
      return
    }

    replaceCanvas(cloneWallpaperPresetToDraft(nextPreset), nextPreset.id, t({ ko: "'{name}'을 열었어.", en: "Opened '{name}'." }, { name: nextPreset.name }))
  }

  const handleMakeLive = () => {
    if (!effectiveActivePresetId || hasUnsavedPresetChanges) return
    syncWallpaperPresetState(savedPresets, effectiveActivePresetId, t({ ko: "'{name}'을 라이브 월페이퍼로 지정했어.", en: "'{name}' is now the live wallpaper." }, { name: activePreset?.name ?? '' }))
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
      undefined,
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

    deleteSavedPreset(effectiveActivePresetId)
  }

  /** Deleting the live preset clears the live choice (the server requires it to name a saved preset). */
  const deleteSavedPreset = (presetId: string) => {
    syncWallpaperPresetState(deleteWallpaperLayoutPreset(savedPresets, presetId), presetId === livePresetId ? null : undefined, t({ ko: '프리셋을 삭제했어.', en: 'Deleted the preset.' }))
    if (presetId === effectiveActivePresetId) setActivePresetId(null)
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
    replaceCanvas(nextLayoutPreset, null, t({ ko: '새 캔버스를 만들었어.', en: 'Started a new canvas.' }))
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
    replaceCanvas(draft, null, t({ ko: "'{name}'을 새 캔버스로 가져왔어. 저장하면 프리셋이 돼.", en: "Imported '{name}' as a new canvas. Save it to make a preset." }, { name: draft.name }))
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
    setIsTemplateModalOpen(false)
    replaceCanvas(nextLayout, null, t({ ko: "'{name}' 템플릿을 적용했어.", en: "Applied the '{name}' template." }, { name: t(template.name) }))
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

  // Style copy carries the look only; each widget keeps its own shown-time window.
  const copySelectionStyle = () => {
    const source = selectedWidgets[0]
    if (!source) return
    const look: Partial<WallpaperWidgetStyle> = { ...source.style }
    delete look.showFrom
    delete look.showUntil
    setStyleClipboard(look)
    writeEditorClipboard(STYLE_CLIPBOARD_KEY, look)
    notifyInfo(t({ ko: '스타일을 복사했어.', en: 'Copied the style.' }))
  }

  const pasteSelectionStyle = () => {
    if (!styleClipboard || effectiveSelectedIds.length === 0) return
    const ids = new Set(effectiveSelectedIds)
    setLayoutPreset((current) => ({ ...current, widgets: current.widgets.map((widget) => (ids.has(widget.id) ? { ...widget, style: { ...widget.style, ...styleClipboard } } : widget)) }))
  }

  const copySelection = () => {
    if (selectedWidgets.length === 0) return
    clipboardRef.current = structuredClone(selectedWidgets)
    writeEditorClipboard(WIDGET_CLIPBOARD_KEY, clipboardRef.current)
  }

  const cutSelection = () => {
    copySelection()
    removeSelection()
  }

  // Each paste lands one step further, so repeated pastes fan out instead of stacking.
  const pasteClipboard = () => {
    if (clipboardRef.current.length === 0) return
    const offset = getWallpaperCopyOffset(layoutPreset)
    const result = pasteWallpaperWidgets(layoutPreset, clipboardRef.current.map((widget) => ({ ...widget, x: widget.x + offset.x, y: widget.y + offset.y })))
    clipboardRef.current = result.layout.widgets.filter((widget) => result.widgetIds.includes(widget.id))
    writeEditorClipboard(WIDGET_CLIPBOARD_KEY, clipboardRef.current)
    setLayoutPreset(result.layout)
    setSelectedIds(result.widgetIds)
  }

  const toggleLockSelection = () => {
    const lock = !selectedWidgets.every((widget) => widget.locked)
    const ids = new Set(effectiveSelectedIds)
    setLayoutPreset((current) => ({ ...current, widgets: current.widgets.map((widget) => (ids.has(widget.id) ? { ...widget, locked: lock } : widget)) }))
  }

  const toggleHiddenSelection = () => {
    const hide = !selectedWidgets.every((widget) => widget.hidden)
    const ids = new Set(effectiveSelectedIds)
    setLayoutPreset((current) => ({ ...current, widgets: current.widgets.map((widget) => (ids.has(widget.id) ? { ...widget, hidden: hide } : widget)) }))
  }

  /** Layer order, Figma style: one step with Ctrl+] / [, to the end with Ctrl+Shift+] / [. */
  const arrangeSelection = (where: 'forward' | 'backward' | 'front' | 'back') => {
    if (effectiveSelectedIds.length === 0) return
    setLayoutPreset((current) => (where === 'front' || where === 'back'
      ? stackWallpaperWidgets(current, effectiveSelectedIds, where)
      : stepWallpaperWidgets(current, effectiveSelectedIds, where)))
  }

  /** Zoom to the selection and center it (Shift+2). */
  const fitSelection = () => {
    if (selectedWidgets.length === 0) return
    const left = Math.min(...selectedWidgets.map((widget) => widget.x))
    const top = Math.min(...selectedWidgets.map((widget) => widget.y))
    const right = Math.max(...selectedWidgets.map((widget) => widget.x + widget.w))
    const bottom = Math.max(...selectedWidgets.map((widget) => widget.y + widget.h))
    setFocusRequest({ frame: { x: left, y: top, w: right - left, h: bottom - top }, nonce: Date.now() })
  }

  const stepZoom = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? zoomPercent / 100 : zoom
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001)
    if (next) setZoom(next)
  }

  // Keyboard: undo/redo, save, delete, nudge, duplicate, cut/copy/paste, styles, select all, layer order, zoom.
  // The handler is rebuilt every render and read through a ref, so the listener never runs a stale closure.
  const handleEditorKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    // Focused controls own their keys: arrows move a slider or a segmented choice, not the selection.
    if (isTypingTarget(event) || target?.closest('[role="slider"],[role="radio"],[role="tab"],[role="menu"],[role="listbox"],[role="option"]')) {
      return
    }
    if (document.querySelector('[role="dialog"]')) {
      return
    }
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (mod && event.altKey && event.code === 'KeyC' && selectedWidgets.length === 1) { event.preventDefault(); copySelectionStyle(); return }
    if (mod && event.altKey && event.code === 'KeyV' && styleClipboard) { event.preventDefault(); pasteSelectionStyle(); return }

    if (mod && !event.altKey) {
      if (event.code === 'KeyS') { event.preventDefault(); if (isAdmin && !wallpaperPresetMutation.isPending) handleSavePreset({ saveAsNew: event.shiftKey }); return }
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); undoLayoutEdit(); return }
      if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); redoLayoutEdit(); return }
      if (key === 'a') { event.preventDefault(); setSelectedIds(layoutPreset.widgets.map((widget) => widget.id)); return }
      if (key === 'd') { event.preventDefault(); duplicateSelection(); return }
      if (key === 'c' && selectedWidgets.length > 0) { copySelection(); return }
      if (key === 'x' && selectedWidgets.length > 0) { event.preventDefault(); cutSelection(); return }
      if (key === 'v' && clipboardRef.current.length > 0) { event.preventDefault(); pasteClipboard(); return }
      // Shift turns `]` into `}` on most layouts, so the physical key decides.
      if (event.code === 'BracketRight' || event.code === 'BracketLeft') {
        event.preventDefault()
        const forward = event.code === 'BracketRight'
        arrangeSelection(event.shiftKey ? (forward ? 'front' : 'back') : (forward ? 'forward' : 'backward'))
        return
      }
      if (event.code === 'Equal' || event.code === 'NumpadAdd') { event.preventDefault(); stepZoom(1); return }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') { event.preventDefault(); stepZoom(-1); return }
      if (event.code === 'Digit0' || event.code === 'Numpad0') { event.preventDefault(); setZoom(1); return }
    }

    if (!mod && !event.altKey && event.shiftKey && event.code === 'Digit1') { event.preventDefault(); setZoom('fit'); return }
    if (!mod && !event.altKey && event.shiftKey && event.code === 'Digit2' && effectiveSelectedIds.length > 0) { event.preventDefault(); fitSelection(); return }
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
  const editorKeyDownRef = useRef(handleEditorKeyDown)
  editorKeyDownRef.current = handleEditorKeyDown
  useEffect(() => {
    const listener = (event: KeyboardEvent) => editorKeyDownRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

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
    livePresetId: effectiveLivePresetId,
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
          deleteSavedPreset(presetId)
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
          setLivelyIssued(wallpaperIssuedKey(token, savedPresets))
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
  const isLivePreset = Boolean(activePreset) && effectiveActivePresetId === effectiveLivePresetId
  const toolbar = (
    <PageToolbar
      start={(<>
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
        {isLivePreset ? (
          <Badge role="status" title={t({ ko: '지금 월페이퍼에 나오는 프리셋', en: 'Shown on the live wallpaper' })}>{t({ ko: '라이브', en: 'Live' })}</Badge>
        ) : null}
      </>)}
      actions={(
        <>
          <IconButton variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undoLayoutEdit} label={t({ ko: '실행 취소 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' })}>
            <Undo2 />
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redoLayoutEdit} label={t({ ko: '다시 실행 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' })}>
            <Redo2 />
          </IconButton>
          <div className="flex items-center">
            <IconButton variant="ghost" size="icon-sm" onClick={() => stepZoom(-1)} label={t({ ko: '축소', en: 'Zoom out' })}>
              <ZoomOut />
            </IconButton>
            <Button
              ref={zoomMenuAnchorRef}
              type="button"
              variant="ghost"
              size="compact"
              className="min-w-12 tabular-nums"
              aria-expanded={isZoomMenuOpen}
              onClick={() => { setZoomDraft(String(zoomPercent)); setIsZoomMenuOpen((current) => !current) }}
              aria-label={t({ ko: '확대 비율', en: 'Zoom level' })}
              title={t({ ko: '확대 비율 (Ctrl+휠로 확대, Space+드래그로 이동)', en: 'Zoom level (Ctrl+wheel to zoom, Space+drag to pan)' })}
            >
              <span className="font-mono">{zoomPercent}%</span>
            </Button>
            <IconButton variant="ghost" size="icon-sm" onClick={() => stepZoom(1)} label={t({ ko: '확대', en: 'Zoom in' })}>
              <ZoomIn />
            </IconButton>
          </div>
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
      <ActionMenuButton
        size="icon-xs"
        icon={AlignStartVertical}
        align="center"
        label={t({ ko: '정렬', en: 'Align' })}
        entries={[
          { key: 'left', label: t({ ko: '왼쪽 정렬', en: 'Align left' }), icon: AlignStartVertical, onSelect: () => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'left')) },
          { key: 'hcenter', label: t({ ko: '가운데 정렬', en: 'Center' }), icon: AlignCenterVertical, onSelect: () => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'hcenter')) },
          { key: 'top', label: t({ ko: '위 정렬', en: 'Align top' }), icon: AlignStartHorizontal, onSelect: () => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, 'top')) },
        ]}
      />
      <span className="mx-0.5 h-4 w-px bg-line" />
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '맨 앞으로 (Ctrl+Shift+])', en: 'Bring to front (Ctrl+Shift+])' })} onClick={() => setLayoutPreset((current) => stackWallpaperWidgets(current, effectiveSelectedIds, 'front'))}><BringToFront /></IconButton>
      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '맨 뒤로 (Ctrl+Shift+[)', en: 'Send to back (Ctrl+Shift+[)' })} onClick={() => setLayoutPreset((current) => stackWallpaperWidgets(current, effectiveSelectedIds, 'back'))}><SendToBack /></IconButton>
      <IconButton variant="ghost" size="icon-xs" active={allSelectedLocked} label={allSelectedLocked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' })} onClick={toggleLockSelection}>{allSelectedLocked ? <Lock /> : <LockOpen />}</IconButton>
      <IconButton variant="destructive-ghost" size="icon-xs" label={t({ ko: '삭제 (Delete)', en: 'Delete (Delete)' })} onClick={removeSelection}><Trash2 /></IconButton>
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
          className="w-64"
        >
          <EditorMenuItems
            items={[
              { icon: Plus, label: t({ ko: '새 캔버스', en: 'New canvas' }), action: () => void handleCreateBlankCanvas() },
              { icon: LayoutTemplate, label: t({ ko: '템플릿', en: 'Templates' }), action: () => setIsTemplateModalOpen(true) },
              'separator',
              { icon: Copy, label: t({ ko: '다른 이름으로 저장', en: 'Save as new' }), disabled: !isAdmin || wallpaperPresetMutation.isPending, action: () => handleSavePreset({ saveAsNew: true }) },
              { icon: Download, label: t({ ko: '파일로 내보내기', en: 'Export to file' }), action: handleExportFile },
              { icon: Upload, label: t({ ko: '파일에서 가져오기', en: 'Import from file' }), action: () => importInputRef.current?.click() },
              'separator',
              ...(activePreset && !isLivePreset ? [{
                icon: Radio,
                label: hasUnsavedPresetChanges ? t({ ko: '저장 후 라이브로 지정', en: 'Save first to make live' }) : t({ ko: '라이브로 지정', en: 'Make live' }),
                disabled: !isAdmin || hasUnsavedPresetChanges || wallpaperPresetMutation.isPending,
                action: handleMakeLive,
              }] : []),
              { icon: Eye, label: t({ ko: '실행 미리보기', en: 'Live preview' }), action: () => window.open(draftRuntimePath, '_blank', 'noopener,noreferrer') },
              { icon: MonitorPlay, label: t({ ko: 'Lively 연결', en: 'Connect Lively' }), disabled: !isAdmin, action: () => setIsLivelyOpen(true) },
              { icon: CalendarClock, label: t({ ko: '시간대별 월페이퍼', en: 'Wallpaper schedule' }), disabled: !isAdmin || savedPresets.length === 0 || !wallpaperSettingsQuery.data, action: () => setIsScheduleOpen(true) },
              { icon: ClipboardCopy, label: t({ ko: '월페이퍼 URL 복사', en: 'Copy wallpaper URL' }), disabled: !activePresetRuntimePath, action: () => void handleCopyRuntimeUrl() },
              { icon: ExternalLink, label: t({ ko: '저장 월페이퍼 열기', en: 'Open saved wallpaper' }), disabled: !activePresetRuntimePath, action: () => activePresetRuntimePath && window.open(activePresetRuntimePath, '_blank', 'noopener,noreferrer') },
              'separator',
              { icon: Magnet, label: snap ? t({ ko: '스냅 끄기', en: 'Turn off snap' }) : t({ ko: '스냅 켜기', en: 'Turn on snap' }), action: () => setSnap((current) => !current) },
              'separator',
              { icon: Trash2, label: t({ ko: '프리셋 삭제', en: 'Delete preset' }), disabled: !isAdmin || !activePreset || wallpaperPresetMutation.isPending, action: handleDeletePreset, destructive: true },
            ]}
            onDone={() => setIsWorkspaceMenuOpen(false)}
          />
        </AnchoredPopup>
        <AnchoredPopup
          open={isZoomMenuOpen}
          anchorRef={zoomMenuAnchorRef}
          onClose={() => setIsZoomMenuOpen(false)}
          align="center"
          className="w-56"
        >
          <form
            className="flex items-center gap-2 px-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault()
              const percent = Number(zoomDraft)
              if (Number.isFinite(percent) && percent > 0) setZoom(Math.min(400, Math.max(5, percent)) / 100)
              setIsZoomMenuOpen(false)
            }}
          >
            <Input
              inputMode="numeric"
              aria-label={t({ ko: '확대 비율', en: 'Zoom level' })}
              mono
              controlSize="compact"
              value={zoomDraft}
              onChange={(event) => setZoomDraft(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </form>
          <EditorMenuItems
            items={[
              { icon: Maximize, label: t({ ko: '화면에 맞추기', en: 'Fit to screen' }), shortcut: 'Shift+1', action: () => setZoom('fit') },
              { icon: Scan, label: t({ ko: '선택에 맞추기', en: 'Fit to selection' }), shortcut: 'Shift+2', disabled: selectedWidgets.length === 0, action: fitSelection },
              { icon: Search, label: '50%', action: () => setZoom(0.5) },
              { icon: Search, label: '100%', shortcut: 'Ctrl+0', action: () => setZoom(1) },
              { icon: Search, label: '200%', action: () => setZoom(2) },
            ]}
            onDone={() => setIsZoomMenuOpen(false)}
          />
        </AnchoredPopup>
        {/* A right click opens the menu at the pointer: an invisible fixed anchor stands in for a button. */}
        <div ref={contextMenuAnchorRef} aria-hidden className="pointer-events-none fixed size-0" style={{ left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0 }} />
        <AnchoredPopup
          open={contextMenu !== null}
          anchorRef={contextMenuAnchorRef}
          onClose={() => setContextMenu(null)}
          align="start"
          sideOffset={2}
          className="w-64"
        >
          {contextMenu?.widgetId ? (
            <EditorMenuItems
              items={[
                { icon: Scissors, label: t({ ko: '잘라내기', en: 'Cut' }), shortcut: 'Ctrl+X', action: cutSelection },
                { icon: Copy, label: t({ ko: '복사', en: 'Copy' }), shortcut: 'Ctrl+C', action: copySelection },
                { icon: CopyPlus, label: t({ ko: '복제', en: 'Duplicate' }), shortcut: 'Ctrl+D', action: duplicateSelection },
                'separator',
                { icon: Paintbrush, label: t({ ko: '스타일 복사', en: 'Copy style' }), shortcut: 'Ctrl+Alt+C', disabled: selectedWidgets.length !== 1, action: copySelectionStyle },
                { icon: PaintRoller, label: t({ ko: '스타일 붙여넣기', en: 'Paste style' }), shortcut: 'Ctrl+Alt+V', disabled: !styleClipboard, action: pasteSelectionStyle },
                'separator',
                { icon: ArrowUp, label: t({ ko: '앞으로', en: 'Bring forward' }), shortcut: 'Ctrl+]', action: () => arrangeSelection('forward') },
                { icon: ArrowDown, label: t({ ko: '뒤로', en: 'Send backward' }), shortcut: 'Ctrl+[', action: () => arrangeSelection('backward') },
                { icon: BringToFront, label: t({ ko: '맨 앞으로', en: 'Bring to front' }), shortcut: 'Ctrl+Shift+]', action: () => arrangeSelection('front') },
                { icon: SendToBack, label: t({ ko: '맨 뒤로', en: 'Send to back' }), shortcut: 'Ctrl+Shift+[', action: () => arrangeSelection('back') },
                'separator',
                { icon: allSelectedLocked ? LockOpen : Lock, label: allSelectedLocked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' }), action: toggleLockSelection },
                { icon: selectedWidgets.every((widget) => widget.hidden) ? Eye : EyeOff, label: selectedWidgets.every((widget) => widget.hidden) ? t({ ko: '보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' }), action: toggleHiddenSelection },
                'separator',
                { icon: Trash2, label: t({ ko: '삭제', en: 'Delete' }), shortcut: 'Del', destructive: true, action: removeSelection },
              ]}
              onDone={() => setContextMenu(null)}
            />
          ) : (
            <EditorMenuItems
              items={[
                { icon: ClipboardPaste, label: t({ ko: '붙여넣기', en: 'Paste' }), shortcut: 'Ctrl+V', disabled: clipboardRef.current.length === 0, action: pasteClipboard },
                { icon: BoxSelect, label: t({ ko: '모두 선택', en: 'Select all' }), shortcut: 'Ctrl+A', disabled: layoutPreset.widgets.length === 0, action: () => setSelectedIds(layoutPreset.widgets.map((widget) => widget.id)) },
                { icon: Maximize, label: t({ ko: '화면에 맞추기', en: 'Fit to screen' }), shortcut: 'Shift+1', action: () => setZoom('fit') },
              ]}
              onDone={() => setContextMenu(null)}
            />
          )}
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
                onZoomChange={setZoom}
                focusRequest={focusRequest}
                onContextMenuRequest={({ widgetId, clientX, clientY }) => setContextMenu({ widgetId, x: clientX, y: clientY })}
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
          <WallpaperColorPaletteContext.Provider value={layoutPalette}>
            <aside
              aria-label={t({ ko: '위젯 설정', en: 'Widget settings' })}
              className="min-w-0 self-start xl:sticky xl:top-(--theme-shell-header-height) xl:max-h-[calc(100dvh-var(--theme-shell-header-height))] xl:overflow-x-hidden xl:overflow-y-auto xl:[scrollbar-gutter:stable] xl:[scrollbar-width:thin] xl:border-l xl:border-line xl:pt-2 xl:pb-6 xl:pl-6 xl:pr-4"
            >
              {selectedWidgets.length > 0 ? (
                <WallpaperWidgetInspector
                  selectedWidgets={selectedWidgets}
                  groups={groupsQuery.data ?? []}
                  onPatchWidgets={(widgetIds, patch, key) => setLayoutPreset((current) => patchWidgets(current, widgetIds, patch), { coalesceKey: key })}
                  onAlign={(mode) => setLayoutPreset((current) => alignWallpaperWidgets(current, effectiveSelectedIds, mode))}
                  onDistribute={(axis) => setLayoutPreset((current) => distributeWallpaperWidgets(current, effectiveSelectedIds, axis))}
                  onCopyStyle={copySelectionStyle}
                  onPasteStyle={styleClipboard ? pasteSelectionStyle : null}
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
          </WallpaperColorPaletteContext.Provider>
        </div>

        {isLivelyOpen ? (
          <WallpaperLivelyConnectModal
            key={livelyIssued?.url ?? 'lively'}
            open
            onClose={() => { setIsLivelyOpen(false); setLivelyIssued(null) }}
            presets={savedPresets}
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
