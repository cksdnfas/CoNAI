import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isFinalResultModule } from '../module-graph-shared'

type ModuleLibraryPanelProps = {
  modules: ModuleDefinitionRecord[]
  isError: boolean
  errorMessage: string
  onAddModule: (module: ModuleDefinitionRecord) => void
  showHeader?: boolean
  surface?: 'card' | 'plain'
}

type ModuleLibraryTab = 'custom' | 'system'

type ModuleGroup = {
  key: string
  label: string
  modules: ModuleDefinitionRecord[]
}

const SYSTEM_GROUP_ORDER = ['prompt', 'image', 'analysis', 'output', 'utility', 'other']
const CUSTOM_GROUP_ORDER = ['nai', 'comfyui', 'other']

function toTitleCase(rawValue: string) {
  return rawValue
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Build a user-facing group for system modules based on practical workflow role. */
function getSystemModuleGroup(module: ModuleDefinitionRecord): { key: string; label: string } {
  const category = (module.category ?? '').toLowerCase()
  const name = module.name.toLowerCase()

  if (isFinalResultModule(module) || category === 'output') {
    return { key: 'output', label: 'Output' }
  }

  if (category === 'analysis' || name.includes('extract')) {
    return { key: 'analysis', label: 'Analysis' }
  }

  if (category === 'prompt' || category === 'prompt-source' || name.includes('prompt')) {
    return { key: 'prompt', label: 'Prompt' }
  }

  if (category === 'image' || category === 'retrieval' || name.includes('image') || name.includes('reference') || name.includes('library')) {
    return { key: 'image', label: 'Image / Retrieval' }
  }

  if (category === 'utility') {
    return { key: 'utility', label: 'Utility' }
  }

  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

/** Build a user-facing group for custom modules with minimal noise. */
function getCustomModuleGroup(module: ModuleDefinitionRecord): { key: string; label: string } {
  if (module.engine_type === 'nai') {
    return { key: 'nai', label: 'NovelAI' }
  }

  if (module.engine_type === 'comfyui') {
    return { key: 'comfyui', label: 'ComfyUI' }
  }

  if (module.engine_type === 'custom_js') {
    return { key: 'custom-js', label: 'Custom JS' }
  }

  const category = (module.category ?? '').toLowerCase()
  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, showHeader = true, surface = 'card' }: ModuleLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ModuleLibraryTab>('custom')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([])

  const customModules = useMemo(() => modules.filter((module) => module.engine_type !== 'system'), [modules])
  const systemModules = useMemo(() => modules.filter((module) => module.engine_type === 'system'), [modules])
  const finalResultModule = useMemo(() => systemModules.find((module) => isFinalResultModule(module)) ?? null, [systemModules])
  const visibleModules = activeTab === 'system' ? systemModules : customModules
  const activeTabLabel = activeTab === 'system' ? '시스템 모듈' : '사용자 모듈'

  useEffect(() => {
    if (activeTab === 'custom' && customModules.length === 0 && systemModules.length > 0) {
      setActiveTab('system')
      return
    }

    if (activeTab === 'system' && systemModules.length === 0 && customModules.length > 0) {
      setActiveTab('custom')
    }
  }, [activeTab, customModules.length, systemModules.length])

  const filteredModules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matchedModules = query.length === 0
      ? visibleModules
      : visibleModules.filter((module) => {
          const haystack = [module.name, module.description ?? '', module.engine_type, module.category ?? '', module.authoring_source].join(' ').toLowerCase()
          return haystack.includes(query)
        })

    return [...matchedModules].sort((left, right) => {
      const finalResultDelta = Number(isFinalResultModule(right)) - Number(isFinalResultModule(left))
      if (finalResultDelta !== 0) {
        return finalResultDelta
      }

      return left.name.localeCompare(right.name, 'ko')
    })
  }, [searchQuery, visibleModules])

  const groupedModules = useMemo(() => {
    const groupMap = new Map<string, ModuleGroup>()

    for (const module of filteredModules) {
      const group = activeTab === 'system' ? getSystemModuleGroup(module) : getCustomModuleGroup(module)
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

    const orderedKeys = activeTab === 'system' ? SYSTEM_GROUP_ORDER : CUSTOM_GROUP_ORDER

    return [...groupMap.values()].sort((left, right) => {
      const leftIndex = orderedKeys.indexOf(left.key)
      const rightIndex = orderedKeys.indexOf(right.key)
      const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
      const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
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
          heading="모듈 라이브러리"
          actions={(
            <>
              <Badge variant="outline">{activeTabLabel}</Badge>
              <Badge variant="outline">{filteredModules.length}</Badge>
            </>
          )}
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
              value: 'custom',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>사용자 모듈</span>
                  <span className="text-xs text-muted-foreground">{customModules.length}</span>
                </span>
              ),
            },
            {
              value: 'system',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>시스템 모듈</span>
                  <span className="text-xs text-muted-foreground">{systemModules.length}</span>
                </span>
              ),
            },
          ]}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={`${activeTab === 'system' ? '시스템' : '사용자'} 모듈 검색`} className="pl-9" />
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>모듈 목록 오류</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isError && activeTab === 'system' && finalResultModule ? (
        <Alert>
          <AlertTitle>권장 출력 노드</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>최종 결과를 표시하려면 Final Result 시스템 노드를 추가해서 원하는 출력에 연결해줘.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(finalResultModule)}>
              Final Result 바로 추가
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {modules.length === 0 ? (
        <Alert>
          <AlertTitle>모듈 없음</AlertTitle>
          <AlertDescription>먼저 모듈을 저장해.</AlertDescription>
        </Alert>
      ) : null}

      {modules.length > 0 && visibleModules.length === 0 ? (
        <Alert>
          <AlertTitle>{activeTab === 'system' ? '시스템 모듈이 아직 없어' : '사용자 모듈이 아직 없어'}</AlertTitle>
          <AlertDescription>{activeTab === 'system' ? '기본 제공 모듈 구성을 확인해봐.' : 'NAI/ComfyUI에서 모듈을 먼저 저장해.'}</AlertDescription>
        </Alert>
      ) : null}

      {visibleModules.length > 0 && filteredModules.length === 0 ? (
        <Alert>
          <AlertTitle>검색 결과가 없어</AlertTitle>
          <AlertDescription>다른 키워드로 찾아봐.</AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-[min(68vh,760px)] space-y-5 overflow-y-auto pr-1">
        {groupedModules.map((group) => {
          const scopedKey = `${activeTab}:${group.key}`
          const isCollapsed = collapsedGroupKeys.includes(scopedKey)

          return (
            <section key={group.key} className="space-y-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center justify-between gap-3 border-b border-border/70 pb-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <div className="text-sm font-semibold text-foreground">{group.label}</div>
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
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{module.name}</span>
                            <Badge variant="outline">{module.engine_type}</Badge>
                            {isFinalResult ? <Badge variant="secondary">최종 결과</Badge> : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            입력 {module.exposed_inputs.length} · 출력 {module.output_ports.length}
                          </div>
                          {module.description ? <div className="truncate text-xs text-muted-foreground">{module.description}</div> : null}
                        </div>

                        <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(module)}>
                          추가
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
