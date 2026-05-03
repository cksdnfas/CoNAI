import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import { useI18n } from '@/i18n'
import {
  type WildcardItemRecord,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import {
  formatWildcardDateTime,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  type WildcardTreeEntry,
} from './wildcard-generation-panel-helpers'

function hasVisibleWildcardItems(items: WildcardItemRecord[]) {
  return items.some((item) => item.content.trim().length > 0)
}

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
  const { t, formatNumber } = useI18n()

  return (
    <SettingsSegmentedTable
      value={activeTool}
      items={[
        { value: 'general', label: 'General' },
        { value: 'nai', label: 'NAI' },
        { value: 'comfyui', label: 'ComfyUI' },
      ]}
      onChange={(value) => onChangeTool(value as WildcardTool)}
      gridClassName="grid-cols-[3rem_minmax(0,1fr)_5rem]"
      headers={[t({ ko: '번호', en: 'No.' }), t({ ko: '내용', en: 'Content' }), t({ ko: '가중치', en: 'Weight' })]}
      count={<Badge variant="outline">{formatNumber(items.length)}</Badge>}
      minWidthClassName="min-w-[520px]"
    >
      {items.length > 0 ? items.map((item, index) => (
        <div key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center px-4 py-3 text-sm transition-colors hover:bg-surface-high/60">
          <div className="text-center font-medium tabular-nums text-muted-foreground">{formatNumber(index + 1)}</div>
          <div className="min-w-0 truncate text-foreground" title={item.content}>{item.content}</div>
          <div className="text-center text-foreground">{item.weight}</div>
        </div>
      )) : <div className="px-4 py-6 text-sm text-muted-foreground">{t({ ko: '등록된 항목이 없어.', en: 'No registered items.' })}</div>}
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
  const { t } = useI18n()
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedWildcardSyntax = selectedWildcard ? getWildcardPromptSyntax(selectedWildcard.name, { type: selectedWildcard.type }) : ''
  const selectedWildcardSyntaxLabel = selectedWildcard ? getWildcardPromptSyntaxLabel({ type: selectedWildcard.type }, { preprocess: t({ ko: '전처리 키워드', en: 'Preprocess keyword' }), wildcard: t({ ko: '와일드카드 문법', en: 'Wildcard syntax' }) }) : t({ ko: '항목 문법', en: 'Item syntax' })
  const [activeItemTool, setActiveItemTool] = useState<WildcardTool>('general')
  const selectedGeneralItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'general'),
    [selectedWildcard],
  )
  const selectedNaiItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'nai'),
    [selectedWildcard],
  )
  const selectedComfyItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'comfyui'),
    [selectedWildcard],
  )
  const activeItems = activeItemTool === 'general' ? selectedGeneralItems : activeItemTool === 'comfyui' ? selectedComfyItems : selectedNaiItems

  useEffect(() => {
    setActiveItemTool(
      hasVisibleWildcardItems(selectedGeneralItems)
        ? 'general'
        : hasVisibleWildcardItems(selectedNaiItems)
          ? 'nai'
          : hasVisibleWildcardItems(selectedComfyItems)
            ? 'comfyui'
            : 'general',
    )
  }, [selectedWildcard?.id, selectedGeneralItems, selectedNaiItems, selectedComfyItems])

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
            title={t({ ko: '클릭해서 복사', en: 'Click to copy' })}
          >
            <code className="truncate text-sm font-medium text-primary">{selectedWildcardSyntax}</code>
          </button>
        ) : t({ ko: '항목 선택', en: 'Select an item' })}
        actions={selectedWildcard ? extraActions : undefined}
      />

      {selectedWildcard ? (
        <div className="space-y-4">
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{t({ ko: '하위 자동 포함 {value}', en: 'Include children {value}' }, { value: selectedWildcard.include_children === 1 ? 'ON' : 'OFF' })}</Badge>
              <Badge variant="outline">{t({ ko: '자식만 {value}', en: 'Only children {value}' }, { value: selectedWildcard.only_children === 1 ? 'ON' : 'OFF' })}</Badge>
              <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
              {selectedWildcard.lora_weight != null ? <Badge variant="outline">LoRA weight {selectedWildcard.lora_weight}</Badge> : null}
            </div>
            <div className="space-y-1 text-xs">
              <div className="break-words">{t({ ko: '경로: {path}', en: 'Path: {path}' }, { path: selectedEntry?.path.join(' / ') ?? selectedWildcard.name })}</div>
              {selectedWildcard.description ? <div>{t({ ko: '설명: {description}', en: 'Description: {description}' }, { description: selectedWildcard.description })}</div> : null}
              {selectedWildcard.source_path ? <div className="break-all">{t({ ko: '소스: {source}', en: 'Source: {source}' }, { source: selectedWildcard.source_path })}</div> : null}
            </div>
          </div>

          <WildcardItemSection
            activeTool={activeItemTool}
            onChangeTool={setActiveItemTool}
            items={activeItems}
          />
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">{t({ ko: '항목을 선택하면 세부 정보를 보여줄게.', en: 'Select an item to see its details.' })}</div>
      )}
    </section>
  )
}

/** Render the latest LoRA auto-collection summary card. */
export function LoraScanLogCard({ log }: { log: WildcardScanLog | null }) {
  const { t, formatNumber, formatDateTime } = useI18n()

  return (
    <section className="space-y-4">
      <SectionHeading
        variant="inside"
        className="border-b border-border/70 pb-4"
        heading={t({ ko: '최근 자동 수집 로그', en: 'Recent auto-collection log' })}
        actions={log ? <Badge variant="outline">{formatNumber(log.totalWildcards)}</Badge> : undefined}
      />

      {log ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t({ ko: '시간', en: 'Time' })}</div>
              <div className="mt-1 text-sm text-foreground">{formatWildcardDateTime(log.timestamp, formatDateTime)}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">LoRA weight</div>
              <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t({ ko: '중복 처리', en: 'Duplicate handling' })}</div>
              <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
            </div>
            <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t({ ko: '생성 항목', en: 'Created items' })}</div>
              <div className="mt-1 text-sm text-foreground">{formatNumber(log.totalItems)}</div>
            </div>
          </div>

          <div className="space-y-2">
            {log.wildcards.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-sm border border-border bg-surface-container px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{getWildcardPromptSyntax(entry.name)}</span>
                  <Badge variant="outline">{t({ ko: '항목 {count}', en: 'Items {count}' }, { count: formatNumber(entry.itemCount) })}</Badge>
                  <Badge variant="outline">{t({ ko: '레벨 {level}', en: 'Level {level}' }, { level: formatNumber(entry.level) })}</Badge>
                </div>
                <div className="mt-1 break-all">{entry.folderName}</div>
              </div>
            ))}
            {log.wildcards.length > 8 ? <div className="text-xs text-muted-foreground">{t({ ko: '외 {count}개 더 있어.', en: '{count} more.' }, { count: formatNumber(log.wildcards.length - 8) })}</div> : null}
          </div>
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">{t({ ko: '아직 기록된 자동 수집 로그가 없어.', en: 'No auto-collection logs recorded yet.' })}</div>
      )}
    </section>
  )
}
