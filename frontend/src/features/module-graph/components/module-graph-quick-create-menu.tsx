import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Settings2 } from 'lucide-react'
import { getBuiltinNodeFamily, getBuiltinNodeVariant, listBuiltinNodeVariants, type BuiltinNodeVariant } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { getModuleBaseDisplayName } from '../module-graph-shared'
import { getModuleNodeKindVisual, type ModuleNodeKind } from '../module-graph-node-kind'
import { shouldHideFromModuleLibrary } from './module-library-groups'
import { useViewportPointAnchor } from './use-viewport-point-anchor'

/** A module that can take the dragged link, with the port it would plug into. */
export type RecommendedModuleMatch = {
  module: ModuleDefinitionRecord
  compatibility: 'exact' | 'string-bridge'
  portLabel: string | null
}

const RECENT_STORAGE_KEY = 'conai:module-graph-recent-modules'
const RECENT_LIMIT = 6
const KIND_ORDER: ModuleNodeKind[] = ['generation', 'input', 'get', 'llm', 'logic', 'utility', 'output', 'custom', 'other']

type RecentModule = { moduleId: number; variantId?: string }

function readRecentModules(): RecentModule[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): RecentModule[] => {
      if (typeof entry === 'number') return [{ moduleId: entry }]
      if (!entry || typeof entry !== 'object' || typeof entry.moduleId !== 'number') return []
      return [{ moduleId: entry.moduleId, variantId: typeof entry.variantId === 'string' ? entry.variantId : undefined }]
    })
  } catch {
    return []
  }
}

function rememberRecentModule(row: PickerRow) {
  try {
    const entry = { moduleId: row.module.id, variantId: row.variant?.id }
    const next = [entry, ...readRecentModules().filter((recent) => recent.moduleId !== entry.moduleId)].slice(0, RECENT_LIMIT)
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: recent nodes just do not show next time.
  }
}

type PickerRow = { module: ModuleDefinitionRecord; variant?: BuiltinNodeVariant; label: string; hint: string | null }
type PickerGroup = { key: string; label: string; rows: PickerRow[] }

/**
 * The one node picker: "+" in the editor bar, double-click on the canvas, right-click "add node" and a link dropped
 * on empty canvas all open it. Search first; without a search it lists what fits the dragged link, recent nodes, then
 * every node by kind (the kind chips narrow it down).
 */
export function ModuleGraphQuickCreateMenu({
  mode,
  anchor,
  align = 'start',
  modules,
  recommendedModules,
  onSelectModule,
  onOpenCustomNodeManager,
  onClose,
}: {
  mode: 'pane' | 'connect'
  anchor: { x: number; y: number }
  align?: 'start' | 'center'
  modules: ModuleDefinitionRecord[]
  recommendedModules: RecommendedModuleMatch[]
  onSelectModule: (module: ModuleDefinitionRecord, inputValues?: Record<string, unknown>) => void
  /** Admins manage custom (code) nodes from here. */
  onOpenCustomNodeManager?: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const anchorRef = useViewportPointAnchor(anchor)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ModuleNodeKind | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentModules] = useState(readRecentModules)
  useOverlayBackClose({ open: true, onClose })

  const kindLabels: Record<ModuleNodeKind, string> = {
    generation: t({ ko: '생성', en: 'Generation' }),
    input: t({ ko: '입력', en: 'Input' }),
    get: t({ ko: '가져오기', en: 'Get' }),
    llm: 'LLM',
    logic: t({ ko: '로직', en: 'Logic' }),
    utility: t({ ko: '유틸리티', en: 'Utility' }),
    output: t({ ko: '최종 결과', en: 'Result' }),
    custom: t({ ko: '커스텀', en: 'Custom' }),
    other: t({ ko: '기타', en: 'Other' }),
  }

  const listedModules = useMemo(() => modules.filter((module) => !shouldHideFromModuleLibrary(module)), [modules])
  const hintById = useMemo(() => new Map(recommendedModules.map((match) => [match.module.id, match.portLabel])), [recommendedModules])
  // A dragged link limits every view, including search and the kind chips.
  const eligibleModules = useMemo(() => mode === 'connect'
    ? listedModules.filter((module) => hintById.has(module.id))
    : listedModules, [hintById, listedModules, mode])

  const groups = useMemo<PickerGroup[]>(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const pool = kindFilter
      ? eligibleModules.filter((module) => getModuleNodeKindVisual(module).kind === kindFilter)
      : eligibleModules
    const byName = (left: PickerRow, right: PickerRow) => left.label.localeCompare(right.label, locale)
    const toRow = (module: ModuleDefinitionRecord, variant?: BuiltinNodeVariant, familyOnly = false): PickerRow => {
      const family = getBuiltinNodeFamily(module)
      return {
        module,
        variant,
        label: family ? familyOnly ? t(family.label) : `${t(family.label)} · ${t((variant ?? getBuiltinNodeVariant(module))?.label ?? family.label)}` : getModuleBaseDisplayName(module),
        hint: hintById.get(module.id) ?? null,
      }
    }
    const variantsFor = (module: ModuleDefinitionRecord) => {
      const family = getBuiltinNodeFamily(module)
      return family ? listBuiltinNodeVariants([module], family.id).map(({ variant }) => toRow(module, variant)) : [toRow(module)]
    }
    const representativeRows = (candidates: ModuleDefinitionRecord[]) => {
      const seen = new Set<string>()
      return candidates.flatMap((module) => {
        const family = getBuiltinNodeFamily(module)
        const key = family ? `family:${family.id}` : `module:${module.id}`
        if (seen.has(key)) return []
        seen.add(key)
        const preferred = family ? listBuiltinNodeVariants(candidates, family.id)[0] : undefined
        return [toRow(preferred?.module ?? module, preferred?.variant, true)]
      })
    }

    if (normalizedQuery) {
      const scored = pool.flatMap(variantsFor)
        .map((row) => {
          const { module, variant } = row
          const family = getBuiltinNodeFamily(module)
          const names = [row.label, getModuleBaseDisplayName(module), module.name, variant?.label.ko, variant?.label.en, ...(variant?.aliases ?? [])].filter((name): name is string => Boolean(name)).map((name) => name.toLowerCase())
          const haystack = [...names, family?.label.ko, family?.label.en, module.description ?? '', module.category ?? '', kindLabels[getModuleNodeKindVisual(module).kind]].join(' ').toLowerCase()
          const score = names.some((name) => name === normalizedQuery) ? 4 : names.some((name) => name.startsWith(normalizedQuery)) ? 3 : names.some((name) => name.includes(normalizedQuery)) ? 2 : haystack.includes(normalizedQuery) ? 1 : 0
          return { row, score }
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => (right.score - left.score) || byName(left.row, right.row))
      return scored.length > 0 ? [{ key: 'search', label: t({ ko: '검색 결과', en: 'Results' }), rows: scored.map((entry) => entry.row) }] : []
    }

    const result: PickerGroup[] = []
    if (mode === 'connect') {
      const rank = (module: ModuleDefinitionRecord) => {
        const recentIndex = recentModules.findIndex((recent) => recent.moduleId === module.id)
        return recentIndex === -1 ? Number.MAX_SAFE_INTEGER : recentIndex
      }
      const matchById = new Map(recommendedModules.map((match) => [match.module.id, match]))
      // Keep the actual compatible module, rather than substituting a family's default.
      const connectable = pool.flatMap(variantsFor).sort((left, right) => {
        const leftCompatibility = matchById.get(left.module.id)?.compatibility
        const rightCompatibility = matchById.get(right.module.id)?.compatibility
        return (leftCompatibility === rightCompatibility ? 0 : leftCompatibility === 'exact' ? -1 : 1)
          || (rank(left.module) - rank(right.module)) || byName(left, right)
      })
      if (connectable.length > 0) result.push({ key: 'connect', label: t({ ko: '연결 가능', en: 'Fits this link' }), rows: connectable })
      return result
    }

    const representatives = representativeRows(pool)
    if (kindFilter) {
      return representatives.length > 0 ? [{ key: kindFilter, label: kindLabels[kindFilter], rows: representatives.sort(byName) }] : []
    }
    const recentFamilies = new Set<string>()
    const recent = recentModules.flatMap((entry) => {
      const module = pool.find((candidate) => candidate.id === entry.moduleId)
      if (!module) return []
      const family = getBuiltinNodeFamily(module)
      const key = family ? `family:${family.id}` : `module:${module.id}`
      if (recentFamilies.has(key)) return []
      recentFamilies.add(key)
      const variant = (family ? listBuiltinNodeVariants([module], family.id).find((candidate) => candidate.variant.id === entry.variantId)?.variant : undefined)
        ?? getBuiltinNodeVariant(module) ?? undefined
      return [toRow(module, variant)]
    })
    if (recent.length > 0) result.push({ key: 'recent', label: t({ ko: '최근', en: 'Recent' }), rows: recent })
    for (const kind of KIND_ORDER) {
      const rows = representatives.filter((row) => getModuleNodeKindVisual(row.module).kind === kind).sort(byName)
      if (rows.length > 0) result.push({ key: kind, label: kindLabels[kind], rows })
    }
    return result
    // kindLabels are rebuilt each render from the same translation function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleModules, hintById, kindFilter, locale, mode, query, recentModules, recommendedModules, t])

  const flatRows = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const presentKinds = useMemo(() => KIND_ORDER.filter((kind) => eligibleModules.some((module) => getModuleNodeKindVisual(module).kind === kind)), [eligibleModules])
  const safeActiveIndex = Math.min(activeIndex, Math.max(flatRows.length - 1, 0))

  useEffect(() => setActiveIndex(0), [query, kindFilter])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row-index="${safeActiveIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [safeActiveIndex])

  const select = (row: PickerRow) => {
    rememberRecentModule(row)
    onSelectModule(row.module, row.variant?.inputValues)
  }

  let rowIndex = -1
  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        data-module-graph-menu=""
        side="bottom"
        align={align}
        sideOffset={0}
        collisionPadding={12}
        padding="none"
        className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-24px)] flex-col overflow-hidden"
        aria-label={t({ ko: '노드 추가', en: 'Add node' })}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (flatRows.length === 0) return
            const delta = event.key === 'ArrowDown' ? 1 : -1
            setActiveIndex((safeActiveIndex + delta + flatRows.length) % flatRows.length)
            return
          }
          if (event.key === 'Enter' && flatRows[safeActiveIndex]) {
            event.preventDefault()
            select(flatRows[safeActiveIndex])
          }
        }}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({ ko: '노드 검색', en: 'Search nodes' })}
            aria-label={t({ ko: '노드 검색', en: 'Search nodes' })}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="shrink-0 rounded-sm border border-line px-1 font-mono text-2xs text-muted-foreground">Esc</kbd>
        </div>

        <div ref={listRef} role="listbox" aria-label={t({ ko: '노드', en: 'Nodes' })} className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {mode === 'connect' && !query && !kindFilter ? t({ ko: '이 연결을 받을 노드가 없어.', en: 'No node takes this link.' }) : t({ ko: '맞는 노드가 없어.', en: 'No matching node.' })}
            </div>
          ) : groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label}>
              <div className="px-3.5 pt-2.5 pb-1 text-2xs font-bold tracking-wider text-muted-foreground">{group.label}</div>
              {group.rows.map((row) => {
                rowIndex += 1
                const index = rowIndex
                const visual = getModuleNodeKindVisual(row.module)
                const Icon = visual.icon
                return (
                  <Button
                    key={`${group.key}-${row.module.id}-${row.variant?.id ?? ''}`}
                    type="button"
                    variant="nav"
                    size="sm"
                    role="option"
                    aria-selected={index === safeActiveIndex}
                    data-active={index === safeActiveIndex}
                    data-row-index={index}
                    title={row.module.description || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(row)}
                  >
                    <span className="grid size-4.5 shrink-0 place-items-center rounded-sm" style={{ background: `color-mix(in srgb, ${visual.color} 16%, transparent)`, color: visual.color }} aria-hidden>
                      <Icon className="size-3" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.hint ? <span className="max-w-[40%] shrink-0 truncate text-2xs font-normal text-muted-foreground">{row.hint}</span> : null}
                  </Button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-2.5 py-2">
          {presentKinds.map((kind) => (
            <ToggleChip key={kind} size="sm" pressed={kindFilter === kind} onClick={() => setKindFilter((current) => (current === kind ? null : kind))}>
              {kindLabels[kind]}
            </ToggleChip>
          ))}
          {onOpenCustomNodeManager ? (
            <IconButton size="icon-xs" variant="ghost" className="ml-auto" label={t({ ko: '커스텀 노드 관리', en: 'Manage custom nodes' })} onClick={onOpenCustomNodeManager}>
              <Settings2 />
            </IconButton>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
