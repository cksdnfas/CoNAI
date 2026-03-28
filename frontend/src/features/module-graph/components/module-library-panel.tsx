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
}

/** Render the reusable module library for graph authoring. */
export function ModuleLibraryPanel({ modules, isError, errorMessage, onAddModule, showHeader = true }: ModuleLibraryPanelProps) {
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
    <Button type="button" size="sm" variant="ghost" onClick={() => setIsCollapsed((current) => !current)}>
      <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
    </Button>
  )

  return (
    <Card className="bg-surface-container">
      {!isCollapsed ? (
        <CardContent className="space-y-3">
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading="Modules"
              description="재사용 가능한 모듈을 검색해서 캔버스에 추가해."
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
              <AlertDescription>먼저 Generate 페이지에서 NAI 또는 ComfyUI 모듈을 하나 저장해줘.</AlertDescription>
            </Alert>
          ) : null}

          {modules.length > 0 && filteredModules.length === 0 ? (
            <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">검색 결과가 없어. 다른 이름이나 엔진 타입으로 찾아봐.</div>
          ) : null}

          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {filteredModules.map((module) => (
              <div key={module.id} className="rounded-sm bg-surface-low p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{module.name}</span>
                      <Badge variant="outline">{module.engine_type}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">입력 {module.exposed_inputs.length} · 출력 {module.output_ports.length}</div>
                    {module.description ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{module.description}</div> : null}
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => onAddModule(module)}>
                    추가
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      ) : (
        <CardContent>
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading="Modules"
              description="재사용 가능한 모듈을 검색해서 캔버스에 추가해."
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
        </CardContent>
      )}
    </Card>
  )
}
