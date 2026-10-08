import { useMemo, useRef, useState } from 'react'
import { Library, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { getModuleBaseDisplayName } from '../module-graph-shared'
import { CUSTOM_NODE_GROUP_ORDER_INDEX, SAVED_MODULE_GROUP_ORDER_INDEX, SYSTEM_GROUP_ORDER_INDEX, getCustomNodeGroup, getModuleGroupSortIndex, getSavedModuleGroup, getSystemModuleGroup, isCustomNodeModule, isGenerationModule, localizeModuleGroupLabel, shouldHideFromModuleLibrary } from './module-library-groups'
import type { RecommendedModuleMatch } from './module-graph-canvas'
import { useViewportPointAnchor } from './use-viewport-point-anchor'
import { EmptyState } from '@/components/ui/empty-state'

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
  onOpenModuleLibrary,
  onClose,
}: {
  mode: 'pane' | 'connect'
  anchor: { x: number; y: number }
  modules: ModuleDefinitionRecord[]
  recommendedModules: RecommendedModuleMatch[]
  onSelectModule: (module: ModuleDefinitionRecord) => void
  /** Footer link to the full module library (saved modules, custom node management). */
  onOpenModuleLibrary?: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const anchorRef = useViewportPointAnchor(anchor)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
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

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="w-[360px] max-w-[calc(100vw-24px)] p-0"
        aria-label={t({ ko: '노드 빠른 생성 메뉴', en: 'Quick node creation menu' })}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => {
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
        <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
          <Text as="div" variant="title">{mode === 'connect' ? t({ ko: '추천 노드 추가', en: 'Add recommended node' }) : t({ ko: '노드 추가', en: 'Add node' })}</Text>
          <IconButton variant="ghost" size="icon-xs" onClick={onClose} label={t({ ko: '빠른 생성 메뉴 닫기', en: 'Close quick create menu' })}>
            <X />
          </IconButton>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-2">
            {tabOptions.map((tabOption) => (
              <Button
                key={tabOption.key}
                type="button"
                size="sm"
                variant={activeTab === tabOption.key ? 'default' : 'secondary'}
                onClick={() => setActiveTab(tabOption.key)}
              >
                {tabOption.key === 'recommended' ? <Sparkles className="h-4 w-4" /> : null}
                {tabOption.label}
              </Button>
            ))}
          </div>

          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={activeTab === 'recommended' ? t({ ko: '추천 노드 검색', en: 'Search recommended nodes' }) : t({ ko: '노드 검색', en: 'Search nodes' })}
          />

          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {groupedModules.length === 0 ? (
              <EmptyState size="compact" title={emptyMessage} />
            ) : groupedModules.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Text as="div" variant="overline" className="font-medium">{activeTab === 'recommended' ? group.label : localizeModuleGroupLabel(group.label, t)}</Text>
                  <Badge variant="outline">{group.modules.length}</Badge>
                </div>

                <div className="space-y-0.5">
                  {group.modules.map((item) => {
                    const module = item.module
                    const isActive = activeModuleId === module.id
                    const itemTitle = [getModuleBaseDisplayName(module), item.recommendedCompatibility ? t({ ko: '호환: {value}', en: 'Compatible: {value}' }, { value: item.recommendedCompatibility }) : null, module.description ?? null]
                      .filter(Boolean)
                      .join('\n')

                    return (
                      <Button
                        key={module.id}
                        type="button"
                        variant="nav"
                        data-active={isActive}
                        className="px-3 text-foreground"
                        onMouseEnter={() => setActiveModuleId(module.id)}
                        onClick={() => onSelectModule(module)}
                        title={itemTitle || undefined}
                      >
                        {activeTab === 'recommended' ? <Sparkles className="size-3.5" aria-hidden /> : null}
                        <span className="truncate">{getModuleBaseDisplayName(module)}</span>
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {onOpenModuleLibrary ? (
          <div className="border-t border-line px-1.5 py-1.5">
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenModuleLibrary}>
              <Library className="size-4" />
              {t({ ko: '모든 모듈', en: 'All modules' })}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
