import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Settings2 } from 'lucide-react'
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

function readRecentModuleIds(): number[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

function rememberRecentModule(moduleId: number) {
  try {
    const next = [moduleId, ...readRecentModuleIds().filter((id) => id !== moduleId)].slice(0, RECENT_LIMIT)
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: recent nodes just do not show next time.
  }
}

type PickerRow = { module: ModuleDefinitionRecord; hint: string | null }
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
  onSelectModule: (module: ModuleDefinitionRecord) => void
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
  const [recentIds] = useState(readRecentModuleIds)
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
  const byName = (left: ModuleDefinitionRecord, right: ModuleDefinitionRecord) => getModuleBaseDisplayName(left).localeCompare(getModuleBaseDisplayName(right), locale)
  const toRow = (module: ModuleDefinitionRecord): PickerRow => ({ module, hint: hintById.get(module.id) ?? null })

  const groups = useMemo<PickerGroup[]>(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const pool = mode === 'connect' && !normalizedQuery && !kindFilter
      ? listedModules.filter((module) => hintById.has(module.id))
      : listedModules

    if (normalizedQuery) {
      const scored = pool
        .map((module) => {
          const name = getModuleBaseDisplayName(module).toLowerCase()
          const haystack = [name, module.description ?? '', module.category ?? '', kindLabels[getModuleNodeKindVisual(module).kind]].join(' ').toLowerCase()
          const score = name.startsWith(normalizedQuery) ? 3 : name.includes(normalizedQuery) ? 2 : haystack.includes(normalizedQuery) ? 1 : 0
          return { module, score: score + (hintById.has(module.id) ? 0.5 : 0) }
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => (right.score - left.score) || byName(left.module, right.module))
      return scored.length > 0 ? [{ key: 'search', label: t({ ko: '검색 결과', en: 'Results' }), rows: scored.map((entry) => toRow(entry.module)) }] : []
    }

    if (kindFilter) {
      const rows = pool.filter((module) => getModuleNodeKindVisual(module).kind === kindFilter).sort(byName).map(toRow)
      return rows.length > 0 ? [{ key: kindFilter, label: kindLabels[kindFilter], rows }] : []
    }

    const result: PickerGroup[] = []
    if (mode === 'connect') {
      const rank = (module: ModuleDefinitionRecord) => {
        const recentIndex = recentIds.indexOf(module.id)
        return recentIndex === -1 ? Number.MAX_SAFE_INTEGER : recentIndex
      }
      const connectable = recommendedModules
        .filter((match) => !shouldHideFromModuleLibrary(match.module))
        .sort((left, right) => (
          (left.compatibility === right.compatibility ? 0 : left.compatibility === 'exact' ? -1 : 1)
          || (rank(left.module) - rank(right.module))
          || byName(left.module, right.module)
        ))
        .map((match) => toRow(match.module))
      if (connectable.length > 0) result.push({ key: 'connect', label: t({ ko: '연결 가능', en: 'Fits this link' }), rows: connectable })
      return result
    }

    const recent = recentIds.map((id) => listedModules.find((module) => module.id === id)).filter((module): module is ModuleDefinitionRecord => Boolean(module))
    if (recent.length > 0) result.push({ key: 'recent', label: t({ ko: '최근', en: 'Recent' }), rows: recent.map(toRow) })
    for (const kind of KIND_ORDER) {
      const rows = pool.filter((module) => getModuleNodeKindVisual(module).kind === kind).sort(byName).map(toRow)
      if (rows.length > 0) result.push({ key: kind, label: kindLabels[kind], rows })
    }
    return result
    // kindLabels / byName / toRow are rebuilt each render from the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintById, kindFilter, listedModules, locale, mode, query, recentIds, recommendedModules, t])

  const flatRows = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const presentKinds = useMemo(() => KIND_ORDER.filter((kind) => listedModules.some((module) => getModuleNodeKindVisual(module).kind === kind)), [listedModules])
  const safeActiveIndex = Math.min(activeIndex, Math.max(flatRows.length - 1, 0))

  useEffect(() => setActiveIndex(0), [query, kindFilter])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row-index="${safeActiveIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [safeActiveIndex])

  const select = (module: ModuleDefinitionRecord) => {
    rememberRecentModule(module.id)
    onSelectModule(module)
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
        className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
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
            select(flatRows[safeActiveIndex].module)
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
          <kbd className="shrink-0 rounded-[4px] border border-line px-1 font-mono text-2xs text-muted-foreground">Esc</kbd>
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
                    key={`${group.key}-${row.module.id}`}
                    type="button"
                    variant="nav"
                    size="sm"
                    role="option"
                    aria-selected={index === safeActiveIndex}
                    data-active={index === safeActiveIndex}
                    data-row-index={index}
                    title={row.module.description || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(row.module)}
                    className="gap-2.5 rounded-none px-3.5 text-foreground transition-none"
                  >
                    <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px]" style={{ background: `color-mix(in srgb, ${visual.color} 16%, transparent)`, color: visual.color }} aria-hidden>
                      <Icon className="size-3" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{getModuleBaseDisplayName(row.module)}</span>
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
