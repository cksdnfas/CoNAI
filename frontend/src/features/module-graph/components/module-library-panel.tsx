import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search, Settings2 } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getModuleBaseDisplayName } from '../module-graph-shared'
import {
  CUSTOM_NODE_GROUP_ORDER_INDEX,
  SAVED_MODULE_GROUP_ORDER_INDEX,
  SYSTEM_GROUP_ORDER_INDEX,
  getCustomNodeGroup,
  getModuleGroupSortIndex,
  getSavedModuleGroup,
  getSystemModuleGroup,
  isCustomNodeModule,
  isFinalResultModule,
  localizeModuleGroupLabel,
  shouldHideFromModuleLibrary,
} from './module-library-groups'

type ModuleLibraryPanelProps = {
  modules: ModuleDefinitionRecord[]
  isError: boolean
  errorMessage: string
  onAddModule: (module: ModuleDefinitionRecord) => void
  onOpenCustomNodeManager?: () => void
  showHeader?: boolean
  surface?: 'card' | 'plain'
}

type ModuleLibraryTab = 'saved' | 'custom-nodes' | 'system'

type ModuleGroup = {
  key: string
  label: string
  modules: ModuleDefinitionRecord[]
}

/** Build one compact native hover tooltip for module-library rows. */
function getModuleHoverTitle(module: ModuleDefinitionRecord) {
  if (!module.description?.trim()) {
    return undefined
  }

  return `${getModuleBaseDisplayName(module)}\n${module.description.trim()}`
}

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, onOpenCustomNodeManager, showHeader: showHeaderProp, surface = 'card' }: ModuleLibraryPanelProps) {
  // Inside a modal (plain surface) the modal title already names it.
  const showHeader = showHeaderProp ?? surface !== 'plain'
  const { isAdmin } = useFeaturePermissions()
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ModuleLibraryTab>('saved')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([])
  const collapsedGroupKeySet = useMemo(() => new Set(collapsedGroupKeys), [collapsedGroupKeys])

  const savedModules = useMemo(() => modules.filter((module) => module.engine_type !== 'system' && !isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module)), [modules])
  const customNodeModules = useMemo(() => modules.filter((module) => isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module)), [modules])
  const systemModules = useMemo(() => modules.filter((module) => module.engine_type === 'system' && !shouldHideFromModuleLibrary(module)), [modules])
  const finalResultModule = useMemo(() => systemModules.find((module) => isFinalResultModule(module)) ?? null, [systemModules])
  const visibleModules = activeTab === 'system' ? systemModules : activeTab === 'custom-nodes' ? customNodeModules : savedModules

  useEffect(() => {
    if (visibleModules.length > 0) {
      return
    }

    const fallbackTab = ([
      ['saved', savedModules.length],
      ['system', systemModules.length],
      ['custom-nodes', customNodeModules.length],
    ] as const).find(([, count]) => count > 0)?.[0]

    if (fallbackTab && fallbackTab !== activeTab) {
      setActiveTab(fallbackTab)
    }
  }, [activeTab, customNodeModules.length, savedModules.length, systemModules.length, visibleModules.length])

  const filteredModules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matchedModules = query.length === 0
      ? visibleModules
      : visibleModules.filter((module) => {
          const haystack = [getModuleBaseDisplayName(module), module.description ?? '', module.engine_type, module.category ?? '', module.authoring_source].join(' ').toLowerCase()
          return haystack.includes(query)
        })

    return [...matchedModules].sort((left, right) => {
      const finalResultDelta = Number(isFinalResultModule(right)) - Number(isFinalResultModule(left))
      if (finalResultDelta !== 0) {
        return finalResultDelta
      }

      return getModuleBaseDisplayName(left).localeCompare(getModuleBaseDisplayName(right), 'ko')
    })
  }, [searchQuery, visibleModules])

  const groupedModules = useMemo(() => {
    const groupMap = new Map<string, ModuleGroup>()

    for (const module of filteredModules) {
      const group = activeTab === 'system'
        ? getSystemModuleGroup(module)
        : activeTab === 'custom-nodes'
          ? getCustomNodeGroup(module)
          : getSavedModuleGroup(module)
      const existing = groupMap.get(group.key)
      if (existing) {
        existing.modules.push(module)
        continue
      }

      groupMap.set(group.key, {
        key: group.key,
        label: group.label,
        modules: [module],
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

      return left.label.localeCompare(right.label, 'ko')
    })
  }, [activeTab, filteredModules])

  useEffect(() => {
    if (groupedModules.length === 0) {
      return
    }

    const visibleKeys = new Set(groupedModules.map((group) => `${activeTab}:${group.key}`))
    setCollapsedGroupKeys((current) => current.filter((key) => !key.startsWith(`${activeTab}:`) || visibleKeys.has(key)))
  }, [activeTab, groupedModules])

  const toggleGroup = (groupKey: string) => {
    const scopedKey = `${activeTab}:${groupKey}`
    setCollapsedGroupKeys((current) => (
      current.includes(scopedKey)
        ? current.filter((key) => key !== scopedKey)
        : [...current, scopedKey]
    ))
  }

  const customNodeManagerButton = activeTab === 'custom-nodes' && onOpenCustomNodeManager ? (
    <IconButton size="icon-sm" variant="secondary" onClick={onOpenCustomNodeManager} label={t({ ko: '커스텀 노드 관리', en: 'Manage custom nodes' })} disabled={!(isAdmin)}>
      <Settings2 />
    </IconButton>
  ) : null

  const content = (
    <div className="space-y-3">
      {showHeader ? (
        <SectionHeading
          variant="inside"
          heading={t({ ko: '모듈 라이브러리', en: 'Module library' })}
          actions={customNodeManagerButton}
        />
      ) : customNodeManagerButton ? (
        <div className="flex justify-end">{customNodeManagerButton}</div>
      ) : null}

      <div className="space-y-3">
        <SegmentedControl
          value={activeTab}
          onChange={(value) => setActiveTab(value as ModuleLibraryTab)}
          size="sm"
          fullWidth
          items={[
            {
              value: 'saved',
              label: t({ ko: '저장된 모듈', en: 'Saved modules' }),
            },
            {
              value: 'system',
              label: t({ ko: '시스템 모듈', en: 'System modules' }),
            },
            {
              value: 'custom-nodes',
              label: t({ ko: '커스텀 노드', en: 'Custom nodes' }),
            },
          ]}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={activeTab === 'system'
              ? t({ ko: '시스템 모듈 검색', en: 'Search system modules' })
              : activeTab === 'custom-nodes'
                ? t({ ko: '커스텀 노드 검색', en: 'Search custom nodes' })
                : t({ ko: '저장된 모듈 검색', en: 'Search saved modules' })}
            className="pl-9"
          />
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '모듈 목록 오류', en: 'Module list error' })}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isError && activeTab === 'system' && finalResultModule ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => onAddModule(finalResultModule)}>
          <Plus className="size-4" />
          {t({ ko: '최종 결과 노드 추가', en: 'Add a final result node' })}
        </Button>
      ) : null}

      {modules.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '모듈 없음', en: 'No modules' })} />
      ) : null}

      {modules.length > 0 && visibleModules.length === 0 ? (
        <EmptyState
          size="compact"
          title={activeTab === 'system'
            ? t({ ko: '시스템 모듈이 아직 없어', en: 'No system modules yet' })
            : activeTab === 'custom-nodes'
              ? t({ ko: '커스텀 노드가 아직 없어', en: 'No custom nodes yet' })
              : t({ ko: '저장된 모듈이 아직 없어', en: 'No saved modules yet' })}
        />
      ) : null}

      {visibleModules.length > 0 && filteredModules.length === 0 ? (
        <EmptyState size="compact" icon={Search} title={t({ ko: '검색 결과가 없어', en: 'No search results' })} />
      ) : null}

      <div className="max-h-[min(68vh,760px)] space-y-3 overflow-y-auto pr-1">
        {groupedModules.map((group) => {
          const scopedKey = `${activeTab}:${group.key}`
          const isCollapsed = collapsedGroupKeySet.has(scopedKey)

          return (
            <section key={group.key} className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.key)}
                className="h-auto w-full justify-between gap-3 px-2 py-1.5 text-left"
              >
                <span className="flex items-center gap-2">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-semibold text-foreground">{localizeModuleGroupLabel(group.label, t)}</span>
                </span>
              </Button>

              {!isCollapsed ? (
                <div>
                  {group.modules.map((module) => {
                    const isFinalResult = isFinalResultModule(module)

                    return (
                      <div
                        key={module.id}
                        data-engine={module.engine_type}
                        className="flex min-h-9 items-center justify-between gap-3 border-b border-line px-2 py-1 last:border-b-0"
                      >
                        <div className={cn('flex min-w-0 items-center gap-2', module.description ? 'cursor-help' : undefined)} title={getModuleHoverTitle(module)}>
                          <span className="truncate text-sm text-foreground">{getModuleBaseDisplayName(module)}</span>
                          {isFinalResult ? <Badge variant="secondary">{t({ ko: '최종 결과', en: 'Final result' })}</Badge> : null}
                        </div>

                        <IconButton size="icon-xs" variant="ghost" onClick={() => onAddModule(module)} label={t({ ko: '추가', en: 'Add' })}>
                          <Plus />
                        </IconButton>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )

  if (surface === 'plain') {
    return content
  }

  return (
    <Section bodyClassName="space-y-3">{content}</Section>
  )
}
