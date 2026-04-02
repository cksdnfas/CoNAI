import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  type WildcardItemRecord,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  formatWildcardDateTime,
  type WildcardTreeEntry,
} from './wildcard-generation-panel-helpers'

/** Render the hierarchical wildcard tree used by the left workspace explorer. */
export function WildcardTree({
  entries,
  selectedId,
  onSelect,
}: {
  entries: WildcardTreeEntry[]
  selectedId: number | null
  onSelect: (wildcardId: number) => void
}) {
  return (
    <HierarchyNav
      items={entries.map((entry) => entry.wildcard)}
      expandable
      selectedId={selectedId}
      onSelect={(wildcard) => onSelect(wildcard.id)}
      getId={(wildcard) => wildcard.id}
      getParentId={(wildcard) => wildcard.parent_id}
      getLabel={(wildcard) => <span className="truncate">{wildcard.name}</span>}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
      renderIcon={(_, state) => (state.hasChildren || state.isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
    />
  )
}

/** Render one wildcard item list section for the active tool preview. */
function WildcardItemSection({ title, items }: { title: string; items: WildcardItemRecord[] }) {
  return (
    <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <Badge variant="outline">{items.length}</Badge>
      </div>

      {items.length > 0 ? (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="rounded-sm border border-border/70 bg-surface-lowest px-3 py-2 text-xs text-muted-foreground">
              <div className="break-words whitespace-pre-wrap text-foreground">{item.content}</div>
              <div className="mt-1">weight {item.weight}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">등록된 항목이 없어.</div>
      )}
    </div>
  )
}

/** Render the selected wildcard details, syntax copy action, and tool-tabbed item list. */
export function WildcardDetailCard({
  selectedEntry,
  onCopySyntax,
  extraActions,
}: {
  selectedEntry: WildcardTreeEntry | null
  onCopySyntax: (text: string, label: string) => Promise<void>
  extraActions?: ReactNode
}) {
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedWildcardSyntax = selectedWildcard ? `++${selectedWildcard.name}++` : ''
  const [activeItemTool, setActiveItemTool] = useState<WildcardTool>('comfyui')
  const selectedNaiItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'nai'),
    [selectedWildcard],
  )
  const selectedComfyItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'comfyui'),
    [selectedWildcard],
  )
  const activeItems = activeItemTool === 'comfyui' ? selectedComfyItems : selectedNaiItems

  useEffect(() => {
    setActiveItemTool('comfyui')
  }, [selectedWildcard?.id])

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading={selectedWildcard ? selectedWildcard.name : '항목 선택'}
          actions={selectedWildcard ? extraActions : undefined}
        />

        {selectedWildcard ? (
          <div className="space-y-4">
            <div className="rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => void onCopySyntax(selectedWildcardSyntax, '와일드카드 문법')}
                className="inline-flex max-w-full items-center rounded-sm bg-surface-lowest px-3 py-2 text-left transition-colors hover:bg-surface-high"
                title="클릭해서 복사"
              >
                <code className="truncate text-base font-semibold text-foreground md:text-lg">{selectedWildcardSyntax}</code>
              </button>
              <div className="mt-3 break-words text-xs">경로: {selectedEntry?.path.join(' / ') ?? selectedWildcard.name}</div>
              {selectedWildcard.description ? <div className="mt-2 text-xs">설명: {selectedWildcard.description}</div> : null}
              {selectedWildcard.source_path ? <div className="mt-2 break-all text-xs">소스: {selectedWildcard.source_path}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">하위 자동 포함 {selectedWildcard.include_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">자식만 {selectedWildcard.only_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
                {selectedWildcard.lora_weight != null ? <Badge variant="outline">LoRA weight {selectedWildcard.lora_weight}</Badge> : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3">
                <button
                  type="button"
                  onClick={() => setActiveItemTool('comfyui')}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                    activeItemTool === 'comfyui'
                      ? 'bg-surface-high text-primary'
                      : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                  )}
                >
                  ComfyUI
                </button>
                <button
                  type="button"
                  onClick={() => setActiveItemTool('nai')}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                    activeItemTool === 'nai'
                      ? 'bg-surface-high text-primary'
                      : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                  )}
                >
                  NAI
                </button>
              </div>

              <WildcardItemSection title={activeItemTool === 'comfyui' ? 'ComfyUI 항목' : 'NAI 항목'} items={activeItems} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">항목을 선택하면 세부 정보를 보여줄게.</div>
        )}
      </CardContent>
    </Card>
  )
}

/** Render the latest LoRA auto-collection summary card. */
export function LoraScanLogCard({ log }: { log: WildcardScanLog | null }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading="최근 자동 수집 로그"
          actions={log ? <Badge variant="outline">{log.totalWildcards}</Badge> : undefined}
        />

        {log ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">시간</div>
                <div className="mt-1 text-sm text-foreground">{formatWildcardDateTime(log.timestamp)}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">LoRA weight</div>
                <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">중복 처리</div>
                <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">생성 항목</div>
                <div className="mt-1 text-sm text-foreground">{log.totalItems}</div>
              </div>
            </div>

            <div className="space-y-2">
              {log.wildcards.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">++{entry.name}++</span>
                    <Badge variant="outline">items {entry.itemCount}</Badge>
                    <Badge variant="outline">level {entry.level}</Badge>
                  </div>
                  <div className="mt-1 break-all">{entry.folderName}</div>
                </div>
              ))}
              {log.wildcards.length > 8 ? <div className="text-xs text-muted-foreground">외 {log.wildcards.length - 8}개 더 있어.</div> : null}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">아직 기록된 자동 수집 로그가 없어.</div>
        )}
      </CardContent>
    </Card>
  )
}
