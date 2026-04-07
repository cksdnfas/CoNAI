import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CUSTOM_GROUP_ORDER, getCustomModuleGroup, getSystemModuleGroup, SYSTEM_GROUP_ORDER } from './module-library-panel'

type QuickCreateTab = 'recommended' | 'system' | 'other'

type ModuleGroup = {
  key: string
  label: string
  modules: ModuleDefinitionRecord[]
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
  recommendedModules: ModuleDefinitionRecord[]
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

  useEffect(() => {
    setActiveTab(mode === 'connect' ? 'recommended' : 'system')
    setSearchQuery('')
  }, [mode, anchor.x, anchor.y])

  const visibleModules = useMemo(() => {
    if (activeTab === 'recommended') {
      return recommendedModules
    }

    if (activeTab === 'system') {
      return modules.filter((module) => module.engine_type === 'system')
    }

    return modules.filter((module) => module.engine_type !== 'system')
  }, [activeTab, modules, recommendedModules])

  const filteredModules = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const matchedModules = normalizedQuery.length === 0
      ? visibleModules
      : visibleModules.filter((module) => {
          const haystack = [module.name, module.description ?? '', module.engine_type, module.category ?? '', module.authoring_source].join(' ').toLowerCase()
          return haystack.includes(normalizedQuery)
        })

    return [...matchedModules].sort((left, right) => left.name.localeCompare(right.name, 'ko'))
  }, [searchQuery, visibleModules])

  const groupedModules = useMemo(() => {
    if (activeTab === 'recommended') {
      return filteredModules.length > 0
        ? [{ key: 'recommended', label: '연결 가능한 노드', modules: filteredModules } satisfies ModuleGroup]
        : []
    }

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

  const emptyMessage = activeTab === 'recommended'
    ? '이 포트와 바로 연결할 만한 추천 노드가 아직 없어.'
    : '조건에 맞는 노드를 찾지 못했어.'

  return (
    <div
      className="absolute z-30 w-[360px] max-w-[calc(100%-16px)] rounded-sm border border-border bg-surface-container/95 shadow-2xl backdrop-blur-sm"
      style={{ left: anchor.x, top: anchor.y }}
      role="dialog"
      aria-label="노드 빠른 생성 메뉴"
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
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={activeTab === 'recommended' ? '추천 노드 검색' : '노드 검색'}
        />

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
                {group.modules.map((module) => (
                  <button
                    key={module.id}
                    type="button"
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-sm border border-border bg-surface-low px-3 py-2 text-left transition hover:bg-surface-high',
                      activeTab === 'recommended' && 'border-primary/35 bg-primary/6',
                    )}
                    onClick={() => onSelectModule(module)}
                    title={module.description ?? undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{module.name}</span>
                      <Badge variant={module.engine_type === 'system' ? 'secondary' : 'outline'}>{module.engine_type}</Badge>
                    </div>
                    {module.description ? (
                      <div className="line-clamp-2 text-xs text-muted-foreground">{module.description}</div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
