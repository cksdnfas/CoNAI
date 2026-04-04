import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ModuleDefinitionRecord } from '@/lib/api'

type ModuleLibraryPanelProps = {
  modules: ModuleDefinitionRecord[]
  isError: boolean
  errorMessage: string
  onAddModule: (module: ModuleDefinitionRecord) => void
  showHeader?: boolean
  surface?: 'card' | 'plain'
}

type ModuleLibraryTab = 'custom' | 'system'

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, showHeader = true, surface = 'card' }: ModuleLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ModuleLibraryTab>('custom')

  const customModules = useMemo(() => modules.filter((module) => module.engine_type !== 'system'), [modules])
  const systemModules = useMemo(() => modules.filter((module) => module.engine_type === 'system'), [modules])
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
    if (query.length === 0) {
      return visibleModules
    }

    return visibleModules.filter((module) => {
      const haystack = [module.name, module.description ?? '', module.engine_type, module.category ?? '', module.authoring_source].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [searchQuery, visibleModules])

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

      <div className="max-h-[min(62vh,720px)] overflow-y-auto pr-1">
        <div className="grid gap-3 md:grid-cols-2">
          {filteredModules.map((module) => {
            const isSystemModule = module.engine_type === 'system'

            return (
              <div key={module.id} className={`flex h-full flex-col gap-3 rounded-sm border p-3 ${isSystemModule ? 'border-primary/40 bg-surface-high' : 'border-border bg-surface-low'}`}>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{module.name}</span>
                    <Badge variant="outline">{module.engine_type}</Badge>
                    <Badge variant={isSystemModule ? 'secondary' : 'outline'}>{isSystemModule ? '기본 제공' : '사용자 정의'}</Badge>
                    {module.category ? <Badge variant="secondary">{module.category}</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">입력 {module.exposed_inputs.length} · 출력 {module.output_ports.length}</div>
                  {module.description ? <div className="line-clamp-3 text-xs text-muted-foreground">{module.description}</div> : null}
                </div>
                <div className="mt-auto flex justify-end">
                  <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(module)}>
                    추가
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
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
