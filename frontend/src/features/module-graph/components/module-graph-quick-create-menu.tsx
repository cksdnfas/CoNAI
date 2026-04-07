import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CUSTOM_GROUP_ORDER, getCustomModuleGroup, getSystemModuleGroup, SYSTEM_GROUP_ORDER } from './module-library-panel'
import type { RecommendedModuleMatch } from './module-graph-canvas'

type QuickCreateTab = 'recommended' | 'system' | 'other'

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
  const tabOptions = mode === 'connect'
    ? ([
        { key: 'recommended', label: '추천 노드' },
        { key: 'system', label: '시스템' },
        { key: 'other', label: '기타' },
      ] as const)
    : ([
        { key: 'system', label: '시스템' },
        { key: 'other', label: '기타' },
      ] as const)
  const [activeTab, setActiveTab] = useState<QuickCreateTab>(mode === 'connect' ? 'recommended' : 'system')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null)

  useEffect(() => {
    setActiveTab(mode === 'connect' ? 'recommended' : 'system')
    setSearchQuery('')
    setActiveModuleId(null)
  }, [mode, anchor.x, anchor.y])

  const visibleModules = useMemo<ModuleListItem[]>(() => {
    if (activeTab === 'recommended') {
      return recommendedModules.map((match) => ({
        module: match.module,
        recommendedCompatibility: match.compatibility,
      }))
    }

    if (activeTab === 'system') {
      return modules
        .filter((module) => module.engine_type === 'system')
        .map((module) => ({ module }))
    }

    return modules
      .filter((module) => module.engine_type !== 'system')
      .map((module) => ({ module }))
  }, [activeTab, modules, recommendedModules])

  const filteredModules = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const matchedModules = normalizedQuery.length === 0
      ? visibleModules
      : visibleModules.filter((item) => {
          const haystack = [item.module.name, item.module.description ?? '', item.module.engine_type, item.module.category ?? '', item.module.authoring_source].join(' ').toLowerCase()
          return haystack.includes(normalizedQuery)
        })

    if (activeTab === 'recommended') {
      return matchedModules
    }

    return [...matchedModules].sort((left, right) => left.module.name.localeCompare(right.module.name, 'ko'))
  }, [activeTab, searchQuery, visibleModules])

  const groupedModules = useMemo(() => {
    if (activeTab === 'recommended') {
      return filteredModules.length > 0
        ? [{ key: 'recommended', label: '연결 가능한 노드', modules: filteredModules } satisfies ModuleGroup]
        : []
    }

    const groupMap = new Map<string, ModuleGroup>()
    for (const item of filteredModules) {
      const group = activeTab === 'system' ? getSystemModuleGroup(item.module) : getCustomModuleGroup(item.module)
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

    const groupOrder = activeTab === 'system' ? SYSTEM_GROUP_ORDER : CUSTOM_GROUP_ORDER
    return [...groupMap.values()].sort((left, right) => {
      const leftIndex = groupOrder.indexOf(left.key)
      const rightIndex = groupOrder.indexOf(right.key)
      const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
      const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex
      }

      return left.label.localeCompare(right.label, 'ko')
    })
  }, [activeTab, filteredModules])

  const flatVisibleModules = useMemo(
    () => groupedModules.flatMap((group) => group.modules),
    [groupedModules],
  )

  useEffect(() => {
    setActiveModuleId((current) => {
      if (flatVisibleModules.length === 0) {
        return null
      }

      if (current && flatVisibleModules.some((item) => item.module.id === current)) {
        return current
      }

      return flatVisibleModules[0]?.module.id ?? null
    })
  }, [flatVisibleModules])

  const emptyMessage = activeTab === 'recommended'
    ? '이 포트와 바로 연결할 만한 추천 노드가 아직 없어.'
    : '조건에 맞는 노드를 찾지 못했어.'

  return (
    <div
      className="absolute z-30 w-[360px] max-w-[calc(100%-16px)] rounded-sm border border-border bg-surface-container/95 shadow-2xl backdrop-blur-sm"
      style={{ left: anchor.x, top: anchor.y }}
      role="dialog"
      aria-label="노드 빠른 생성 메뉴"
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
          const currentIndex = flatVisibleModules.findIndex((item) => item.module.id === activeModuleId)
          const fallbackIndex = currentIndex === -1 ? 0 : currentIndex
          const delta = event.key === 'ArrowDown' ? 1 : -1
          const nextIndex = (fallbackIndex + delta + flatVisibleModules.length) % flatVisibleModules.length
          setActiveModuleId(flatVisibleModules[nextIndex]?.module.id ?? null)
          return
        }

        if (event.key === 'Enter' && activeModuleId) {
          const targetModule = flatVisibleModules.find((item) => item.module.id === activeModuleId)?.module
          if (targetModule) {
            event.preventDefault()
            onSelectModule(targetModule)
          }
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold text-foreground">노드 추가</div>
          <div className="text-xs text-muted-foreground">
            {mode === 'connect' ? '연결 가능한 노드를 빠르게 골라서 바로 이어붙여.' : '그래프 빈 곳에서 노드를 바로 추가해.'}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="빠른 생성 메뉴 닫기" title="닫기">
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
          placeholder={activeTab === 'recommended' ? '추천 노드 검색' : '노드 검색'}
        />

        <div className="flex items-center justify-between rounded-sm border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <ArrowUp className="h-3.5 w-3.5" />
            <ArrowDown className="h-3.5 w-3.5" />
            <span>이동</span>
          </div>
          <div className="flex items-center gap-2">
            <CornerDownLeft className="h-3.5 w-3.5" />
            <span>선택</span>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">Esc</kbd>
          </div>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {groupedModules.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : groupedModules.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{group.label}</div>
                <Badge variant="outline">{group.modules.length}</Badge>
              </div>

              <div className="space-y-1.5">
                {group.modules.map((item) => {
                  const module = item.module
                  const isActive = activeModuleId === module.id

                  return (
                    <button
                      key={module.id}
                      type="button"
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-sm border border-border bg-surface-low px-3 py-2 text-left transition hover:bg-surface-high',
                        activeTab === 'recommended' && 'border-primary/35 bg-primary/6',
                        isActive && 'border-primary bg-primary/10 shadow-sm',
                      )}
                      onMouseEnter={() => setActiveModuleId(module.id)}
                      onClick={() => onSelectModule(module)}
                      title={module.description ?? undefined}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{module.name}</span>
                        <div className="flex items-center gap-1.5">
                          {item.recommendedCompatibility ? (
                            <Badge variant={item.recommendedCompatibility === 'exact' ? 'secondary' : 'outline'}>
                              {item.recommendedCompatibility === 'exact' ? 'exact' : 'bridge'}
                            </Badge>
                          ) : null}
                          <Badge variant={module.engine_type === 'system' ? 'secondary' : 'outline'}>{module.engine_type}</Badge>
                        </div>
                      </div>
                      {module.description ? (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{module.description}</div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
