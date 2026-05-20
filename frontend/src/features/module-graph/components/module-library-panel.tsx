import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, onOpenCustomNodeManager, showHeader = true, surface = 'card' }: ModuleLibraryPanelProps) {
  const { t, formatNumber } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ModuleLibraryTab>('saved')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([])
  const collapsedGroupKeySet = useMemo(() => new Set(collapsedGroupKeys), [collapsedGroupKeys])

  const savedModules = useMemo(() => modules.filter((module) => module.engine_type !== 'system' && !isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module)), [modules])
  const customNodeModules = useMemo(() => modules.filter((module) => isCustomNodeModule(module) && !shouldHideFromModuleLibrary(module)), [modules])
  const systemModules = useMemo(() => modules.filter((module) => module.engine_type === 'system' && !shouldHideFromModuleLibrary(module)), [modules])
  const finalResultModule = useMemo(() => systemModules.find((module) => isFinalResultModule(module)) ?? null, [systemModules])
  const visibleModules = activeTab === 'system' ? systemModules : activeTab === 'custom-nodes' ? customNodeModules : savedModules
  const activeTabLabel = activeTab === 'system'
    ? t({ ko: '시스템 모듈', en: 'System modules' })
    : activeTab === 'custom-nodes'
      ? t({ ko: '커스텀 노드', en: 'Custom nodes' })
      : t({ ko: '저장된 모듈', en: 'Saved modules' })

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

  const content = (
    <div className="space-y-3">
      {showHeader ? (
        <SectionHeading
          variant="inside"
          heading={t({ ko: '모듈 라이브러리', en: 'Module library' })}
          actions={(
            <>
              {activeTab === 'custom-nodes' && onOpenCustomNodeManager ? (
                <Button type="button" size="sm" variant="outline" onClick={onOpenCustomNodeManager}>
                  {t({ ko: '커스텀 노드 관리', en: 'Manage custom nodes' })}
                </Button>
              ) : null}
              <Badge variant="outline">{activeTabLabel}</Badge>
              <Badge variant="outline">{filteredModules.length}</Badge>
            </>
          )}
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'custom-nodes' && onOpenCustomNodeManager ? (
              <Button type="button" size="sm" variant="outline" onClick={onOpenCustomNodeManager}>
                {t({ ko: '커스텀 노드 관리', en: 'Manage custom nodes' })}
              </Button>
            ) : null}
            <Badge variant="outline">{activeTabLabel}</Badge>
            <Badge variant="outline">{filteredModules.length}</Badge>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <SegmentedControl
          value={activeTab}
          onChange={(value) => setActiveTab(value as ModuleLibraryTab)}
          size="sm"
          fullWidth
          items={[
            {
              value: 'saved',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>{t({ ko: '저장된 모듈', en: 'Saved modules' })}</span>
                  <span className="text-xs text-muted-foreground">{formatNumber(savedModules.length)}</span>
                </span>
              ),
            },
            {
              value: 'system',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>{t({ ko: '시스템 모듈', en: 'System modules' })}</span>
                  <span className="text-xs text-muted-foreground">{formatNumber(systemModules.length)}</span>
                </span>
              ),
            },
            {
              value: 'custom-nodes',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>{t({ ko: '커스텀 노드', en: 'Custom nodes' })}</span>
                  <span className="text-xs text-muted-foreground">{formatNumber(customNodeModules.length)}</span>
                </span>
              ),
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
        <Alert>
          <AlertTitle>{t({ ko: '권장 출력 노드', en: 'Recommended output node' })}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t({ ko: '최종 결과를 표시하려면 최종 결과 시스템 노드를 추가해서 원하는 출력에 연결해줘.', en: 'To display a final result, add the final-result system node and connect it to the output you want.' })}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(finalResultModule)}>
              {t({ ko: '최종 결과 바로 추가', en: 'Add final result now' })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {modules.length === 0 ? (
        <Alert>
          <AlertTitle>{t({ ko: '모듈 없음', en: 'No modules' })}</AlertTitle>
          <AlertDescription>{t({ ko: '먼저 모듈을 저장해.', en: 'Save a module first.' })}</AlertDescription>
        </Alert>
      ) : null}

      {modules.length > 0 && visibleModules.length === 0 ? (
        <Alert>
          <AlertTitle>{activeTab === 'system'
            ? t({ ko: '시스템 모듈이 아직 없어', en: 'No system modules yet' })
            : activeTab === 'custom-nodes'
              ? t({ ko: '커스텀 노드가 아직 없어', en: 'No custom nodes yet' })
              : t({ ko: '저장된 모듈이 아직 없어', en: 'No saved modules yet' })}</AlertTitle>
          <AlertDescription>{activeTab === 'system'
            ? t({ ko: '기본 제공 모듈 구성을 확인해봐.', en: 'Check the built-in module setup.' })
            : activeTab === 'custom-nodes'
              ? t({ ko: '커스텀 노드 관리에서 로컬 노드를 스캔하거나 생성해.', en: 'Scan or create local nodes from custom node management.' })
              : t({ ko: 'ComfyUI 워크플로우에서 저장된 모듈을 만들 수 있어.', en: 'Create saved modules from ComfyUI workflows.' })}</AlertDescription>
        </Alert>
      ) : null}

      {visibleModules.length > 0 && filteredModules.length === 0 ? (
        <Alert>
          <AlertTitle>{t({ ko: '검색 결과가 없어', en: 'No search results' })}</AlertTitle>
          <AlertDescription>{t({ ko: '다른 키워드로 찾아봐.', en: 'Try a different keyword.' })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-[min(68vh,760px)] space-y-5 overflow-y-auto pr-1">
        {groupedModules.map((group) => {
          const scopedKey = `${activeTab}:${group.key}`
          const isCollapsed = collapsedGroupKeySet.has(scopedKey)

          return (
            <section key={group.key} className="space-y-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center justify-between gap-3 border-b border-border/70 pb-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <div className="text-sm font-semibold text-foreground">{localizeModuleGroupLabel(group.label, t)}</div>
                </div>
                <Badge variant="outline">{group.modules.length}</Badge>
              </button>

              {!isCollapsed ? (
                <div className="space-y-1">
                  {group.modules.map((module) => {
                    const isSystemModule = module.engine_type === 'system'
                    const isFinalResult = isFinalResultModule(module)

                    return (
                      <div
                        key={module.id}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5',
                          isSystemModule ? 'border-primary/25 bg-surface-high/70' : 'border-border bg-surface-low',
                        )}
                      >
                        <div className={cn('min-w-0 space-y-1', module.description ? 'cursor-help' : undefined)} title={getModuleHoverTitle(module)}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{getModuleBaseDisplayName(module)}</span>
                            <Badge variant="outline">{module.engine_type}</Badge>
                            {isFinalResult ? <Badge variant="secondary">{t({ ko: '최종 결과', en: 'Final result' })}</Badge> : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {t({ ko: '입력 {inputs} · 출력 {outputs}', en: 'Inputs {inputs} · Outputs {outputs}' }, { inputs: formatNumber(module.exposed_inputs.length), outputs: formatNumber(module.output_ports.length) })}
                          </div>
                        </div>

                        <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(module)}>
                          {t({ ko: '추가', en: 'Add' })}
                        </Button>
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
    <Card>
      <CardContent className="space-y-3">{content}</CardContent>
    </Card>
  )
}
