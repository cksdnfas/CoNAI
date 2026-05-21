import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getModuleBaseDisplayName } from '../module-graph-shared'
import { CUSTOM_NODE_GROUP_ORDER_INDEX, SAVED_MODULE_GROUP_ORDER_INDEX, SYSTEM_GROUP_ORDER_INDEX, getCustomNodeGroup, getModuleGroupSortIndex, getSavedModuleGroup, getSystemModuleGroup, isCustomNodeModule, isGenerationModule, localizeModuleGroupLabel, shouldHideFromModuleLibrary } from './module-library-groups'
import type { RecommendedModuleMatch } from './module-graph-canvas'

type QuickCreateTab = 'recommended' | 'system' | 'generation' | 'custom-nodes'

type ModuleListItem = {
  module: ModuleDefinitionRecord
  recommendedCompatibility?: RecommendedModuleMatch['compatibility']
}

type ModuleGroup = {
  key: string
  label: string
  modules: ModuleListItem[]
}

/** Render one lightweight graph-context menu for creating nodes from pane/right-click or dropped connections. */
export function ModuleGraphQuickCreateMenu({
  mode,
  anchor,
  modules,
  recommendedModules,
  onSelectModule,
  onClose,
}: {
  mode: 'pane' | 'connect'
  anchor: { x: number; y: number }
  modules: ModuleDefinitionRecord[]
  recommendedModules: RecommendedModuleMatch[]
  onSelectModule: (module: ModuleDefinitionRecord) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const tabOptions = mode === 'connect'
    ? ([
        { key: 'recommended', label: t({ ko: '추천 노드', en: 'Recommended' }) },
        { key: 'system', label: t({ ko: '시스템', en: 'System' }) },
        { key: 'generation', label: t({ ko: '생성', en: 'Generation' }) },
        { key: 'custom-nodes', label: t({ ko: '커스텀 노드', en: 'Custom nodes' }) },
      ] as const)
    : ([
        { key: 'system', label: t({ ko: '시스템', en: 'System' }) },
        { key: 'generation', label: t({ ko: '생성', en: 'Generation' }) },
        { key: 'custom-nodes', label: t({ ko: '커스텀 노드', en: 'Custom nodes' }) },
      ] as const)
  const [activeTab, setActiveTab] = useState<QuickCreateTab>(mode === 'connect' ? 'recommended' : 'system')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeModuleIdState, setActiveModuleId] = useState<number | null>(null)

  useOverlayBackClose({ open: true, onClose })

  const visibleModules = useMemo<ModuleListItem[]>(() => {
    if (activeTab === 'recommended') {
      return recommendedModules
        .filter((match) => !shouldHideFromModuleLibrary(match.module))
        .map((match) => ({
          module: match.module,
          recommendedCompatibility: match.compatibility,
        }))
    }

    if (activeTab === 'system') {
      return modules
        .filter((module) => module.engine_type === 'system' && !shouldHideFromModuleLibrary(module))
        .map((module) => ({ module }))
    }

    if (activeTab === 'generation') {
      return modules
        .filter((module) => isGenerationModule(module) && !isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module))
        .map((module) => ({ module }))
    }

    return modules
      .filter((module) => isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module))
      .map((module) => ({ module }))
  }, [activeTab, modules, recommendedModules])

  const filteredModules = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const matchedModules = normalizedQuery.length === 0
      ? visibleModules
      : visibleModules.filter((item) => {
          const haystack = [getModuleBaseDisplayName(item.module), item.module.description ?? '', item.module.engine_type, item.module.category ?? '', item.module.authoring_source].join(' ').toLowerCase()
          return haystack.includes(normalizedQuery)
        })

    if (activeTab === 'recommended') {
      return matchedModules
    }

    return [...matchedModules].sort((left, right) => getModuleBaseDisplayName(left.module).localeCompare(getModuleBaseDisplayName(right.module), locale))
  }, [activeTab, locale, searchQuery, visibleModules])

  const groupedModules = useMemo(() => {
    if (activeTab === 'recommended') {
      return filteredModules.length > 0
        ? [{ key: 'recommended', label: t({ ko: '연결 가능한 노드', en: 'Connectable nodes' }), modules: filteredModules } satisfies ModuleGroup]
        : []
    }

    const groupMap = new Map<string, ModuleGroup>()
    for (const item of filteredModules) {
      const group = activeTab === 'system'
        ? getSystemModuleGroup(item.module)
        : activeTab === 'custom-nodes'
          ? getCustomNodeGroup(item.module)
          : item.module.engine_type === 'system'
            ? getSystemModuleGroup(item.module)
            : getSavedModuleGroup(item.module)
      const existing = groupMap.get(group.key)
      if (existing) {
        existing.modules.push(item)
        continue
      }

      groupMap.set(group.key, {
        key: group.key,
        label: group.label,
        modules: [item],
      })
    }

    const groupOrderIndex = activeTab === 'system'
      ? SYSTEM_GROUP_ORDER_INDEX
      : activeTab === 'custom-nodes'
        ? CUSTOM_NODE_GROUP_ORDER_INDEX
        : SAVED_MODULE_GROUP_ORDER_INDEX
    return [...groupMap.values()].sort((left, right) => {
      const normalizedLeftIndex = getModuleGroupSortIndex(groupOrderIndex, left.key)
      const normalizedRightIndex = getModuleGroupSortIndex(groupOrderIndex, right.key)
      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex
      }

      return left.label.localeCompare(right.label, locale)
    })
  }, [activeTab, filteredModules, locale, t])

  const flatVisibleModules = useMemo(
    () => groupedModules.flatMap((group) => group.modules),
    [groupedModules],
  )
  const visibleModuleLookup = useMemo(() => {
    const modulesById = new Map<number, ModuleDefinitionRecord>()
    const indexById = new Map<number, number>()
    flatVisibleModules.forEach((item, index) => {
      modulesById.set(item.module.id, item.module)
      indexById.set(item.module.id, index)
    })

    return { modulesById, indexById }
  }, [flatVisibleModules])
  const activeModuleId = activeModuleIdState && visibleModuleLookup.modulesById.has(activeModuleIdState)
    ? activeModuleIdState
    : flatVisibleModules[0]?.module.id ?? null
  const activeModule = activeModuleId ? visibleModuleLookup.modulesById.get(activeModuleId) ?? null : null

  const emptyMessage = activeTab === 'recommended'
    ? t({ ko: '이 포트와 바로 연결할 만한 추천 노드가 아직 없어.', en: 'There are no recommended nodes that can connect directly to this port yet.' })
    : t({ ko: '조건에 맞는 노드를 찾지 못했어.', en: 'No nodes matched your conditions.' })

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div
        className="fixed z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-sm border border-border bg-surface-container/95 shadow-2xl backdrop-blur-sm"
        style={{ left: anchor.x, top: anchor.y }}
        role="dialog"
        aria-label={t({ ko: '노드 빠른 생성 메뉴', en: 'Quick node creation menu' })}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }

          if (flatVisibleModules.length === 0) {
            return
          }

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const currentIndex = activeModuleId ? visibleModuleLookup.indexById.get(activeModuleId) ?? -1 : -1
            const fallbackIndex = currentIndex === -1 ? 0 : currentIndex
            const delta = event.key === 'ArrowDown' ? 1 : -1
            const nextIndex = (fallbackIndex + delta + flatVisibleModules.length) % flatVisibleModules.length
            setActiveModuleId(flatVisibleModules[nextIndex]?.module.id ?? null)
            return
          }

          if (event.key === 'Enter' && activeModule) {
            event.preventDefault()
            onSelectModule(activeModule)
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="text-sm font-semibold text-foreground">{mode === 'connect' ? t({ ko: '추천 노드 추가', en: 'Add recommended node' }) : t({ ko: '노드 추가', en: 'Add node' })}</div>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label={t({ ko: '빠른 생성 메뉴 닫기', en: 'Close quick create menu' })} title={t({ ko: '닫기', en: 'Close' })}>
            ×
          </Button>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-2">
            {tabOptions.map((tabOption) => (
              <Button
                key={tabOption.key}
                type="button"
                size="sm"
                variant={activeTab === tabOption.key ? 'default' : 'outline'}
                onClick={() => setActiveTab(tabOption.key)}
              >
                {tabOption.key === 'recommended' ? <Sparkles className="h-4 w-4" /> : null}
                {tabOption.label}
              </Button>
            ))}
          </div>

          <Input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={activeTab === 'recommended' ? t({ ko: '추천 노드 검색', en: 'Search recommended nodes' }) : t({ ko: '노드 검색', en: 'Search nodes' })}
          />

          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {groupedModules.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : groupedModules.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{activeTab === 'recommended' ? group.label : localizeModuleGroupLabel(group.label, t)}</div>
                  <Badge variant="outline">{group.modules.length}</Badge>
                </div>

                <div className="space-y-1.5">
                  {group.modules.map((item) => {
                    const module = item.module
                    const isActive = activeModuleId === module.id
                    const itemTitle = [getModuleBaseDisplayName(module), item.recommendedCompatibility ? t({ ko: '호환: {value}', en: 'Compatible: {value}' }, { value: item.recommendedCompatibility }) : null, module.description ?? null]
                      .filter(Boolean)
                      .join('\n')

                    return (
                      <button
                        key={module.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center rounded-sm border border-border bg-surface-low px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-surface-high',
                          activeTab === 'recommended' && 'border-primary/35 bg-primary/6',
                          isActive && 'border-primary bg-primary/10 shadow-sm',
                        )}
                        onMouseEnter={() => setActiveModuleId(module.id)}
                        onClick={() => onSelectModule(module)}
                        title={itemTitle || undefined}
                      >
                        <span className="truncate">{getModuleBaseDisplayName(module)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
