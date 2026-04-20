import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import {
  type WildcardItemRecord,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  formatWildcardDateTime,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
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

/** Render one read-only wildcard item list with the shared settings-style segmented table shell. */
function WildcardItemSection({
  activeTool,
  onChangeTool,
  items,
}: {
  activeTool: WildcardTool
  onChangeTool: (tool: WildcardTool) => void
  items: WildcardItemRecord[]
}) {
  return (
    <SettingsSegmentedTable
      value={activeTool}
      items={[
        { value: 'comfyui', label: 'ComfyUI' },
        { value: 'nai', label: 'NAI' },
      ]}
      onChange={(value) => onChangeTool(value as WildcardTool)}
      gridClassName="grid-cols-[3rem_minmax(0,1fr)_5rem]"
      headers={['번호', '내용', '가중치']}
      count={<Badge variant="outline">{items.length}</Badge>}
      minWidthClassName="min-w-[520px]"
    >
      {items.length > 0 ? items.map((item, index) => (
        <div key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center px-4 py-3 text-sm transition-colors hover:bg-surface-high/60">
          <div className="text-center font-medium tabular-nums text-muted-foreground">{index + 1}</div>
          <div className="min-w-0 truncate text-foreground" title={item.content}>{item.content}</div>
          <div className="text-center text-foreground">{item.weight}</div>
        </div>
      )) : <div className="px-4 py-6 text-sm text-muted-foreground">등록된 항목이 없어.</div>}
    </SettingsSegmentedTable>
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
  const selectedWildcardSyntax = selectedWildcard ? getWildcardPromptSyntax(selectedWildcard.name, { type: selectedWildcard.type }) : ''
  const selectedWildcardSyntaxLabel = selectedWildcard ? getWildcardPromptSyntaxLabel({ type: selectedWildcard.type }) : '항목 문법'
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
    <section className="space-y-4">
      <SectionHeading
        variant="inside"
        className="border-b border-border/70 pb-4"
        heading={selectedWildcard ? (
          <button
            type="button"
            onClick={() => void onCopySyntax(selectedWildcardSyntax, selectedWildcardSyntaxLabel)}
            className="inline-flex max-w-full items-center rounded-sm text-left transition-colors hover:text-foreground"
            title="클릭해서 복사"
          >
            <code className="truncate text-sm font-medium text-primary">{selectedWildcardSyntax}</code>
          </button>
        ) : '항목 선택'}
        actions={selectedWildcard ? extraActions : undefined}
      />

      {selectedWildcard ? (
        <div className="space-y-4">
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">하위 자동 포함 {selectedWildcard.include_children === 1 ? 'ON' : 'OFF'}</Badge>
              <Badge variant="outline">자식만 {selectedWildcard.only_children === 1 ? 'ON' : 'OFF'}</Badge>
              <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
              {selectedWildcard.lora_weight != null ? <Badge variant="outline">LoRA weight {selectedWildcard.lora_weight}</Badge> : null}
            </div>
            <div className="space-y-1 text-xs">
              <div className="break-words">경로: {selectedEntry?.path.join(' / ') ?? selectedWildcard.name}</div>
              {selectedWildcard.description ? <div>설명: {selectedWildcard.description}</div> : null}
              {selectedWildcard.source_path ? <div className="break-all">소스: {selectedWildcard.source_path}</div> : null}
            </div>
          </div>

          <WildcardItemSection
            activeTool={activeItemTool}
            onChangeTool={setActiveItemTool}
            items={activeItems}
          />
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">항목을 선택하면 세부 정보를 보여줄게.</div>
      )}
    </section>
  )
}

/** Render the latest LoRA auto-collection summary card. */
export function LoraScanLogCard({ log }: { log: WildcardScanLog | null }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        variant="inside"
        className="border-b border-border/70 pb-4"
        heading="최근 자동 수집 로그"
        actions={log ? <Badge variant="outline">{log.totalWildcards}</Badge> : undefined}
      />

      {log ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">시간</div>
              <div className="mt-1 text-sm text-foreground">{formatWildcardDateTime(log.timestamp)}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">LoRA weight</div>
              <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">중복 처리</div>
              <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">생성 항목</div>
              <div className="mt-1 text-sm text-foreground">{log.totalItems}</div>
            </div>
          </div>

          <div className="space-y-2">
            {log.wildcards.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-sm border border-border bg-surface-container px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{getWildcardPromptSyntax(entry.name)}</span>
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
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">아직 기록된 자동 수집 로그가 없어.</div>
      )}
    </section>
  )
}
