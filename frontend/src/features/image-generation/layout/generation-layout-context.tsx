import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  GENERATION_LAYOUT_SURFACES,
  createDefaultGenerationLayoutPreset,
  isGenerationLayoutPluginBlock,
  normalizeGenerationLayoutPresets,
  type GenerationLayoutBlock,
  type GenerationLayoutPreset,
  type GenerationLayoutSnapshot,
  type GenerationLayoutSurface,
} from '@conai/shared'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { GENERATION_LAYOUTS_QUERY_KEY, getGenerationLayouts, saveGenerationLayouts } from '@/lib/api-generation-layouts'
import { usePluginGenerationContributions, type PluginLayoutBlock } from '@/features/plugins/plugin-generation'
import { GENERATION_LAYOUT_BLOCK_LABELS } from './generation-layout-labels'
import { stackedLayoutBlocks, withPluginBlocks } from './generation-layout-ops'

const storageKey = (surface: GenerationLayoutSurface) => `conai.generation-layout.preset.${surface}`

function readStoredPresetId(surface: GenerationLayoutSurface) {
  try {
    return window.localStorage.getItem(storageKey(surface))
  } catch {
    return null
  }
}

function writeStoredPresetId(surface: GenerationLayoutSurface, id: string) {
  try {
    window.localStorage.setItem(storageKey(surface), id)
  } catch {
    // Storage can be unavailable; the pick still holds for this visit.
  }
}

type LayoutDraft = { surface: GenerationLayoutSurface; presets: GenerationLayoutPreset[]; editingId: string; revision: string }

type GenerationLayoutContextValue = {
  /** The surface on screen (registered by the layout that renders it); null when the tab has none. */
  activeSurface: GenerationLayoutSurface | null
  registerSurface: (surface: GenerationLayoutSurface) => () => void
  /** Saved presets, or the draft list while that surface is edited. */
  presetsOf: (surface: GenerationLayoutSurface) => GenerationLayoutPreset[]
  /** The arrangement on screen: the viewer's pick, or the preset being edited. */
  presetOf: (surface: GenerationLayoutSurface) => GenerationLayoutPreset
  selectPreset: (surface: GenerationLayoutSurface, id: string) => void
  canEdit: boolean
  /** Surface being edited, if any. */
  editing: GenerationLayoutSurface | null
  saving: boolean
  startEditing: (surface: GenerationLayoutSurface) => void
  cancelEditing: () => void
  save: () => void
  updatePreset: (update: (preset: GenerationLayoutPreset) => GenerationLayoutPreset) => void
  /** Replace the draft preset list (add/rename/reorder/delete), keeping `editingId` valid. */
  updatePresets: (update: (presets: GenerationLayoutPreset[]) => GenerationLayoutPreset[], editingId?: string) => void
  /** Blocks enabled plugins add to the surface. */
  pluginBlocksOf: (surface: GenerationLayoutSurface) => PluginLayoutBlock[]
  /** A block's name: the built-in label or the plugin page's title. */
  blockLabel: (block: GenerationLayoutBlock) => string
}

const GenerationLayoutContext = createContext<GenerationLayoutContextValue | null>(null)

/** Shared generation-page layout presets: everyone picks one per surface, admins edit the lists in place. */
export function GenerationLayoutProvider({ children }: PropsWithChildren) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const canEdit = useAuthStatusQuery().data?.isAdmin === true
  const layoutsQuery = useQuery({
    queryKey: GENERATION_LAYOUTS_QUERY_KEY,
    queryFn: ({ signal }) => getGenerationLayouts(signal),
    staleTime: 60_000,
  })
  const [selected, setSelected] = useState<Partial<Record<GenerationLayoutSurface, string>>>({})
  const [draft, setDraft] = useState<LayoutDraft | null>(null)
  const [activeSurface, setActiveSurface] = useState<GenerationLayoutSurface | null>(null)
  const { blocks: pluginBlocks } = usePluginGenerationContributions()
  const pluginBlocksOf = useCallback((surface: GenerationLayoutSurface) => pluginBlocks.filter((block) => block.surfaces.includes(surface)), [pluginBlocks])
  const withPlugins = useCallback((surface: GenerationLayoutSurface, presets: GenerationLayoutPreset[]) => {
    const available = pluginBlocksOf(surface).map((block) => block.key)
    return presets.map((preset) => withPluginBlocks(preset, available))
  }, [pluginBlocksOf])
  const blockLabel = useCallback((block: GenerationLayoutBlock) => {
    if (!isGenerationLayoutPluginBlock(block)) return t(GENERATION_LAYOUT_BLOCK_LABELS[block])
    return pluginBlocks.find((item) => item.key === block)?.page.title ?? block.split(':')[1]
  }, [pluginBlocks, t])

  // Leaving the edited surface (tab switch, workflow closed) drops the unsaved draft.
  useEffect(() => {
    if (draft && draft.surface !== activeSurface) setDraft(null)
  }, [activeSurface, draft])

  // One stable list per surface, so screens reading the preset don't see a new object on every render.
  const savedPresets = useMemo(() => Object.fromEntries(GENERATION_LAYOUT_SURFACES.map((surface) => [
    surface, withPlugins(surface, layoutsQuery.data?.[surface]?.presets ?? normalizeGenerationLayoutPresets(surface, [])),
  ])) as Record<GenerationLayoutSurface, GenerationLayoutPreset[]>, [layoutsQuery.data, withPlugins])
  const savedPresetsOf = useCallback((surface: GenerationLayoutSurface) => savedPresets[surface], [savedPresets])

  const presetsOf = useCallback((surface: GenerationLayoutSurface) => (
    draft?.surface === surface ? draft.presets : savedPresetsOf(surface)
  ), [draft, savedPresetsOf])

  const presetOf = useCallback((surface: GenerationLayoutSurface) => {
    const presets = presetsOf(surface)
    const id = draft?.surface === surface ? draft.editingId : selected[surface] ?? readStoredPresetId(surface)
    return presets.find((item) => item.id === id) ?? presets[0]
  }, [draft, presetsOf, selected])

  const registerSurface = useCallback((surface: GenerationLayoutSurface) => {
    setActiveSurface(surface)
    return () => setActiveSurface((current) => (current === surface ? null : current))
  }, [])

  const saveMutation = useMutation({
    mutationFn: (current: LayoutDraft) => saveGenerationLayouts(current.surface, normalizeGenerationLayoutPresets(current.surface, current.presets), current.revision),
    onSuccess: (snapshot, current) => {
      queryClient.setQueryData<GenerationLayoutSnapshot>(GENERATION_LAYOUTS_QUERY_KEY, (data) => data && { ...data, [current.surface]: snapshot })
      setSelected((items) => ({ ...items, [current.surface]: current.editingId }))
      writeStoredPresetId(current.surface, current.editingId)
      setDraft(null)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '레이아웃을 저장하지 못했어.', en: 'Could not save the layout.' }), tone: 'error' })
      void queryClient.invalidateQueries({ queryKey: GENERATION_LAYOUTS_QUERY_KEY })
    },
  })

  const value = useMemo<GenerationLayoutContextValue>(() => ({
    activeSurface,
    registerSurface,
    presetsOf,
    presetOf,
    selectPreset: (surface, id) => {
      if (draft?.surface === surface) {
        setDraft({ ...draft, editingId: id })
        return
      }
      setSelected((items) => ({ ...items, [surface]: id }))
      writeStoredPresetId(surface, id)
    },
    canEdit,
    editing: draft?.surface ?? null,
    saving: saveMutation.isPending,
    startEditing: (surface) => {
      const snapshot = layoutsQuery.data?.[surface]
      if (!snapshot) return
      setDraft({ surface, presets: withPlugins(surface, snapshot.presets), editingId: presetOf(surface).id, revision: snapshot.revision })
    },
    cancelEditing: () => setDraft(null),
    save: () => { if (draft) saveMutation.mutate(draft) },
    updatePreset: (update) => setDraft((current) => current && {
      ...current,
      presets: current.presets.map((item) => item.id === current.editingId ? update(item) : item),
    }),
    updatePresets: (update, editingId) => setDraft((current) => {
      if (!current) return current
      const next = update(current.presets)
      if (next.length === 0) return current
      const nextEditingId = editingId ?? current.editingId
      return { ...current, presets: next, editingId: next.some((item) => item.id === nextEditingId) ? nextEditingId : next[0].id }
    }),
    pluginBlocksOf,
    blockLabel,
  }), [activeSurface, blockLabel, canEdit, draft, layoutsQuery.data, pluginBlocksOf, presetOf, presetsOf, registerSurface, saveMutation, withPlugins])

  return <GenerationLayoutContext.Provider value={value}>{children}</GenerationLayoutContext.Provider>
}

export function useGenerationLayout() {
  const value = useContext(GenerationLayoutContext)
  if (!value) throw new Error('useGenerationLayout needs GenerationLayoutProvider')
  return value
}

const ignoreUpdate = () => {}
const noPluginBlocks: PluginLayoutBlock[] = []

/** The surface the screen shows right now (for the Generate bar's plugin buttons); null outside a layout. */
export function useActiveGenerationLayoutSurface() {
  return useContext(GenerationLayoutContext)?.activeSurface ?? null
}

/** The surface's visible plugin blocks in narrow-stack order, without claiming the toolbar (for screens that stack their own sections). */
export function useStackedPluginBlocks(surface: GenerationLayoutSurface) {
  const context = useContext(GenerationLayoutContext)
  if (!context || context.editing === surface) return noPluginBlocks
  const blocks = context.pluginBlocksOf(surface)
  if (!blocks.length) return noPluginBlocks
  return stackedLayoutBlocks(context.presetOf(surface)).flatMap((key) => blocks.filter((block) => block.key === key))
}

/** Block names, also outside the provider (built-in labels only there). */
export function useGenerationLayoutBlockLabel() {
  const context = useContext(GenerationLayoutContext)
  const { t } = useI18n()
  return context?.blockLabel ?? ((block: GenerationLayoutBlock) => isGenerationLayoutPluginBlock(block) ? block.split(':')[1] : t(GENERATION_LAYOUT_BLOCK_LABELS[block]))
}

/**
 * One surface's layout, registered as the screen's active surface while mounted (the toolbar edits that one).
 * Outside the provider it is the surface's built-in default and never editable.
 * `active: false` keeps a mounted-but-hidden screen (e.g. an inactive tab) from claiming the toolbar.
 */
export function useGenerationLayoutSurface(surface: GenerationLayoutSurface, { active = true }: { active?: boolean } = {}) {
  const context = useContext(GenerationLayoutContext)
  const register = context?.registerSurface
  useEffect(() => (register && active ? register(surface) : undefined), [active, register, surface])
  if (!context) return { surface, preset: createDefaultGenerationLayoutPreset(surface), editing: false, updatePreset: ignoreUpdate, pluginBlocks: noPluginBlocks }
  return { surface, preset: context.presetOf(surface), editing: context.editing === surface, updatePreset: context.updatePreset, pluginBlocks: context.pluginBlocksOf(surface) }
}
