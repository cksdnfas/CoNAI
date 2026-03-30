import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ModuleDefinitionRecord } from '@/lib/api'

type ModuleLibraryPanelProps = {
  modules: ModuleDefinitionRecord[]
  isError: boolean
  errorMessage: string
  onAddModule: (module: ModuleDefinitionRecord) => void
  showHeader?: boolean
  surface?: 'card' | 'plain'
}

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, showHeader = true, surface = 'card' }: ModuleLibraryPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredModules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query.length === 0) {
      return modules
    }

    return modules.filter((module) => {
      const haystack = [module.name, module.description ?? '', module.engine_type, module.category ?? ''].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [modules, searchQuery])

  const collapseButton = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={() => setIsCollapsed((current) => !current)}
      aria-label={isCollapsed ? '모듈 펼치기' : '모듈 접기'}
      title={isCollapsed ? '모듈 펼치기' : '모듈 접기'}
    >
      <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
    </Button>
  )

  const content = !isCollapsed ? (
    <div className="space-y-3">
      {showHeader ? (
        <SectionHeading
          variant="inside"
          heading="Modules"
          actions={
            <>
              <Badge variant="outline">{filteredModules.length}</Badge>
              {collapseButton}
            </>
          }
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Badge variant="outline">{filteredModules.length}</Badge>
          {collapseButton}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="모듈 검색" className="pl-9" />
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

      {modules.length > 0 && filteredModules.length === 0 ? (
        <Alert>
          <AlertTitle>검색 결과가 없어</AlertTitle>
          <AlertDescription>다른 키워드로 찾아봐.</AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {filteredModules.map((module) => (
          <div key={module.id} className={cn('rounded-sm border p-3', module.engine_type === 'system' ? 'border-primary/40 bg-surface-high' : 'border-border bg-surface-low')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{module.name}</span>
                  <Badge variant="outline">{module.engine_type}</Badge>
                  {module.category ? <Badge variant="secondary">{module.category}</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">입력 {module.exposed_inputs.length} · 출력 {module.output_ports.length}</div>
                {module.description ? <div className="line-clamp-2 text-xs text-muted-foreground">{module.description}</div> : null}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(module)}>
                추가
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div>
      {showHeader ? (
        <SectionHeading
          variant="inside"
          heading="Modules"
          actions={
            <>
              <Badge variant="outline">{filteredModules.length}</Badge>
              {collapseButton}
            </>
          }
        />
      ) : (
        <div className="flex justify-between gap-3">
          <Badge variant="outline">{filteredModules.length}</Badge>
          {collapseButton}
        </div>
      )}
    </div>
  )

  if (surface === 'plain') {
    return content
  }

  return (
    <Card className="bg-surface-container">
      <CardContent className={isCollapsed ? undefined : 'space-y-3'}>{content}</CardContent>
    </Card>
  )
}
