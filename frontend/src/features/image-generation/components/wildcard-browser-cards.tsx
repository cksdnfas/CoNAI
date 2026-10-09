import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { StatTile } from '@/components/ui/stat-tile'
import { Tip } from '@/components/ui/tooltip'
import { SidebarTree } from '@/features/prompts/components/sidebar-tree'
import { useI18n } from '@/i18n'
import {
  type WildcardItemRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api-wildcards'
import {
  formatWildcardDateTime,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  type WildcardTreeEntry,
} from './wildcard-generation-panel-helpers'

function hasVisibleWildcardItems(items: WildcardItemRecord[]) {
  return items.some((item) => item.content.trim().length > 0)
}

/** Render the hierarchical wildcard tree used by the sidebar explorer. */
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
    <SidebarTree
      items={entries.map((entry) => entry.wildcard)}
      selectedId={selectedId}
      onSelect={(wildcard) => onSelect(wildcard.id)}
      getId={(wildcard) => wildcard.id}
      getParentId={(wildcard) => wildcard.parent_id}
      getLabel={(wildcard) => wildcard.name}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
    />
  )
}

/** Render one read-only wildcard item list: tool switch over hairline rows. */
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
    <RowGroup
      heading={(
        <SegmentedControl
          value={activeTool}
          items={[
            { value: 'general', label: 'General' },
            { value: 'nai', label: 'NAI' },
            { value: 'comfyui', label: 'ComfyUI' },
          ]}
          onChange={(value) => onChangeTool(value as WildcardTool)}
          size="xs"
        />
      )}
      headingAs="div"
      actions={<span className="text-xs tabular-nums text-muted-foreground">{formatNumber(items.length)}</span>}
      bodyClassName="pt-2"
    >
      <ListRow
        size="sm"
        className="text-xs text-muted-foreground/75"
        leading={<span className="w-8 text-center">{t({ ko: '번호', en: 'No.' })}</span>}
        trailing={<span className="w-16 text-right">{t({ ko: '가중치', en: 'Weight' })}</span>}
      >
        {t({ ko: '내용', en: 'Content' })}
      </ListRow>
      {items.length > 0 ? items.map((item, index) => (
        <ListRow
          key={item.id}
          leading={<span className="w-8 text-center text-xs tabular-nums text-muted-foreground">{formatNumber(index + 1)}</span>}
          trailing={<span className="w-16 text-right tabular-nums">{item.weight}</span>}
        >
          <span className="min-w-0 truncate" title={item.content}>{item.content}</span>
        </ListRow>
      )) : <p className="py-4 text-sm text-muted-foreground">{t({ ko: '등록된 항목이 없어.', en: 'No registered items.' })}</p>}
    </RowGroup>
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

  if (!selectedWildcard) {
    return <EmptyState size="compact" title={t({ ko: '선택된 항목 없음', en: 'Nothing selected' })} />
  }

  return (
    <section className="space-y-6">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Tip content={t({ ko: '와일드카드 문법 복사', en: 'Copy wildcard syntax' })}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onCopySyntax(selectedWildcardSyntax, selectedWildcardSyntaxLabel)}
            className="-ml-2 min-w-0 max-w-full"
          >
            <code className="truncate text-base font-semibold text-foreground">{selectedWildcardSyntax}</code>
          </Button>
        </Tip>
        {extraActions ? <div className="flex shrink-0 items-center gap-1">{extraActions}</div> : null}
      </div>

      {selectedWildcard ? (
        <div className="space-y-6">
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
      ) : null}
    </section>
  )
}

/** Render the latest LoRA auto-collection summary card. */
export function LoraScanLogCard({ log }: { log: WildcardScanLog | null }) {
  const { t, formatNumber, formatDateTime } = useI18n()

  return (
    <RowGroup
      headingAs="h2"
      heading={t({ ko: '최근 자동 수집 로그', en: 'Recent auto-collection log' })}
      actions={log ? <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(log.totalWildcards)}</span> : undefined}
      bodyClassName="space-y-6 pt-2"
    >
      {log ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label={t({ ko: '시간', en: 'Time' })} value={formatWildcardDateTime(log.timestamp, formatDateTime)} valueClassName="font-normal" />
            <StatTile label={t({ ko: 'LoRA 가중치', en: 'LoRA weight' })} value={log.loraWeight} valueClassName="font-normal" />
            <StatTile label={t({ ko: '중복 처리', en: 'Duplicate handling' })} value={log.duplicateHandling} valueClassName="font-normal" />
            <StatTile label={t({ ko: '생성 항목', en: 'Created items' })} value={formatNumber(log.totalItems)} valueClassName="font-normal" />
          </div>

          <div>
            {log.wildcards.slice(0, 8).map((entry) => (
              <ListRow
                key={entry.id}
                size="lg"
                trailing={(
                  <span className="text-xs tabular-nums">
                    {t({ ko: '항목 {count}', en: 'Items {count}' }, { count: formatNumber(entry.itemCount) })}
                    {' · '}
                    {t({ ko: '레벨 {level}', en: 'Level {level}' }, { level: formatNumber(entry.level) })}
                  </span>
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{getWildcardPromptSyntax(entry.name)}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={entry.folderName}>{entry.folderName}</span>
                </span>
              </ListRow>
            ))}
            {log.wildcards.length > 8 ? <div className="pt-2 text-xs text-muted-foreground">{t({ ko: '외 {count}개 더 있어.', en: '{count} more.' }, { count: formatNumber(log.wildcards.length - 8) })}</div> : null}
          </div>
        </>
      ) : (
        <EmptyState size="compact" title={t({ ko: '아직 기록된 자동 수집 로그가 없어.', en: 'No auto-collection logs recorded yet.' })} />
      )}
    </RowGroup>
  )
}
