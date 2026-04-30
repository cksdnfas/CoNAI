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
import type { ModuleDefinitionRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getModuleBaseDisplayName, getModuleOperationKey, isFinalResultModule } from '../module-graph-shared'

type ModuleLibraryPanelProps = {
  modules: ModuleDefinitionRecord[]
  isError: boolean
  errorMessage: string
  onAddModule: (module: ModuleDefinitionRecord) => void
  onOpenCustomNodeManager?: () => void
  showHeader?: boolean
  surface?: 'card' | 'plain'
}

type ModuleLibraryTab = 'custom' | 'system'

type ModuleGroup = {
  key: string
  label: string
  modules: ModuleDefinitionRecord[]
}

export const SYSTEM_GROUP_ORDER = ['input', 'logic', 'utility', 'get', 'llm', 'output', 'other']
export const CUSTOM_GROUP_ORDER = ['nai', 'codex', 'comfyui', 'other']

const GET_MODULE_OPERATION_KEYS = new Set([
  'system.find_similar_images',
  'system.load_prompt_from_reference',
  'system.load_image_from_reference',
  'system.random_image_from_library',
  'system.random_video_from_library',
])

function toTitleCase(rawValue: string) {
  return rawValue
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getNormalizedModuleName(module: ModuleDefinitionRecord) {
  return getModuleBaseDisplayName(module).trim().toLowerCase()
}

export function shouldHideFromModuleLibrary(module: ModuleDefinitionRecord) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey === 'system.constant_text') {
    return false
  }

  if (operationKey === 'system.constant_prompt' || operationKey === 'system.generate_image_codex') {
    return true
  }

  const normalizedCategory = (module.category ?? '').trim().toLowerCase()
  const inputPort = module.exposed_inputs[0]
  const outputPort = module.output_ports[0]
  const looksLikeLegacyPromptConstant = module.engine_type === 'system'
    && normalizedCategory === 'input'
    && module.exposed_inputs.length === 1
    && module.output_ports.length === 1
    && inputPort?.key === 'prompt'
    && inputPort?.data_type === 'text'
    && outputPort?.key === 'prompt'
    && outputPort?.data_type === 'text'

  return module.name.trim() === '상수 프롬프트' || looksLikeLegacyPromptConstant
}

/** Build one compact native hover tooltip for module-library rows. */
function getModuleHoverTitle(module: ModuleDefinitionRecord) {
  if (!module.description?.trim()) {
    return undefined
  }

  return `${getModuleBaseDisplayName(module)}\n${module.description.trim()}`
}

/** Build a user-facing group for system modules based on practical workflow role. */
export function getSystemModuleGroup(module: ModuleDefinitionRecord): { key: string; label: string } {
  const category = (module.category ?? '').trim().toLowerCase()
  const name = getNormalizedModuleName(module)
  const operationKey = getModuleOperationKey(module)

  if (isFinalResultModule(module) || category === 'output') {
    return { key: 'output', label: 'END' }
  }

  if (category === 'logic') {
    return { key: 'logic', label: 'Logic' }
  }

  if (
    category === 'input'
    || category === 'prompt-source'
    || operationKey?.startsWith('system.constant_')
    || operationKey === 'system.random_prompt_from_group'
    || name.includes('상수')
  ) {
    return { key: 'input', label: 'Input' }
  }

  if (
    category === 'image'
    || category === 'video'
    || category === 'retrieval'
    || GET_MODULE_OPERATION_KEYS.has(operationKey ?? '')
    || name.includes('찾기')
    || name.includes('불러오기')
    || name.includes('라이브러리')
  ) {
    return { key: 'get', label: 'Get' }
  }

  if (category === 'llm') {
    return { key: 'llm', label: 'LLM' }
  }

  if (category === 'analysis' || category === 'utility' || category === 'prompt' || name.includes('추출')) {
    return { key: 'utility', label: 'Utility' }
  }

  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

/** Build a user-facing group for custom modules with minimal noise. */
export function getCustomModuleGroup(module: ModuleDefinitionRecord): { key: string; label: string } {
  if (module.engine_type === 'nai') {
    return { key: 'nai', label: 'NovelAI' }
  }

  if (module.engine_type === 'codex') {
    return { key: 'codex', label: 'Codex' }
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

function localizeModuleGroupLabel(label: string, t: ReturnType<typeof useI18n>['t']) {
  switch (label) {
    case 'Input':
      return t({ ko: '입력', en: 'Input' })
    case 'Get':
      return t({ ko: '가져오기', en: 'Get' })
    case 'Logic':
      return t({ ko: '로직', en: 'Logic' })
    case 'Utility':
      return t({ ko: '유틸리티', en: 'Utility' })
    case 'Other':
      return t({ ko: '기타', en: 'Other' })
    case 'END':
      return t({ ko: '최종 결과', en: 'END' })
    case 'Custom JS':
      return t({ ko: '커스텀 JS', en: 'Custom JS' })
    default:
      return label
  }
}

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, onOpenCustomNodeManager, showHeader = true, surface = 'card' }: ModuleLibraryPanelProps) {
  const { t, formatNumber } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ModuleLibraryTab>('custom')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([])

  const customModules = useMemo(() => modules.filter((module) => module.engine_type !== 'system' && !shouldHideFromModuleLibrary(module)), [modules])
  const systemModules = useMemo(() => modules.filter((module) => module.engine_type === 'system' && !shouldHideFromModuleLibrary(module)), [modules])
  const finalResultModule = useMemo(() => systemModules.find((module) => isFinalResultModule(module)) ?? null, [systemModules])
  const visibleModules = activeTab === 'system' ? systemModules : customModules
  const activeTabLabel = activeTab === 'system' ? t({ ko: '시스템 모듈', en: 'System modules' }) : t({ ko: '사용자 모듈', en: 'Custom modules' })

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
          heading={t({ ko: '모듈 라이브러리', en: 'Module library' })}
          actions={(
            <>
              {activeTab === 'custom' && onOpenCustomNodeManager ? (
                <Button type="button" size="sm" variant="outline" onClick={onOpenCustomNodeManager}>
                  {t({ ko: 'Custom Nodes 관리', en: 'Manage Custom Nodes' })}
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
            {activeTab === 'custom' && onOpenCustomNodeManager ? (
              <Button type="button" size="sm" variant="outline" onClick={onOpenCustomNodeManager}>
                {t({ ko: 'Custom Nodes 관리', en: 'Manage Custom Nodes' })}
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
              value: 'custom',
              label: (
                <span className="flex items-center justify-center gap-2">
                  <span>{t({ ko: '사용자 모듈', en: 'Custom modules' })}</span>
                  <span className="text-xs text-muted-foreground">{formatNumber(customModules.length)}</span>
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
          ]}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={activeTab === 'system' ? t({ ko: '시스템 모듈 검색', en: 'Search system modules' }) : t({ ko: '사용자 모듈 검색', en: 'Search custom modules' })} className="pl-9" />
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
          <AlertTitle>{activeTab === 'system' ? t({ ko: '시스템 모듈이 아직 없어', en: 'No system modules yet' }) : t({ ko: '사용자 모듈이 아직 없어', en: 'No custom modules yet' })}</AlertTitle>
          <AlertDescription>{activeTab === 'system' ? t({ ko: '기본 제공 모듈 구성을 확인해봐.', en: 'Check the built-in module setup.' }) : t({ ko: 'NAI/ComfyUI에서 모듈을 먼저 저장해.', en: 'Save a module from NAI/ComfyUI first.' })}</AlertDescription>
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
