import { Badge } from '@/components/ui/badge'
import { SettingsInsetBlock, SettingsSection, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import type { PromptCollectionItem, PromptGroupRecord, PromptStatistics, PromptTypeFilter } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { PROMPT_TYPE_TABS, getPromptTypeTotal } from '../prompt-page-utils'

interface PromptSummaryPanelProps {
  promptType: PromptTypeFilter
  statistics?: PromptStatistics
  topPrompts?: PromptCollectionItem[]
  groupStatistics?: PromptGroupRecord[]
}

function getTypeLabel(promptType: PromptTypeFilter) {
  return PROMPT_TYPE_TABS.find((tab) => tab.value === promptType)?.label ?? 'Prompt'
}

export function PromptSummaryPanel({ promptType, statistics, topPrompts = [], groupStatistics = [] }: PromptSummaryPanelProps) {
  const { t, formatNumber } = useI18n()
  const topGroups = [...groupStatistics]
    .filter((group) => group.id !== 0)
    .sort((left, right) => (right.prompt_count ?? 0) - (left.prompt_count ?? 0))
    .slice(0, 5)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <SettingsSection heading={t({ ko: '{typeLabel} 요약', en: '{typeLabel} summary' }, { typeLabel: getTypeLabel(promptType) })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <SettingsValueTile
            label="Current type total"
            value={formatNumber(getPromptTypeTotal(promptType, statistics))}
            valueClassName="text-2xl"
          />
          <SettingsValueTile
            label="All positive"
            value={formatNumber(statistics?.total_prompts ?? 0)}
            valueClassName="text-2xl"
          />
          <SettingsValueTile
            label="All negative / auto"
            value={`${formatNumber(statistics?.total_negative_prompts ?? 0)} / ${formatNumber(statistics?.total_auto_prompts ?? 0)}`}
            valueClassName="text-2xl"
          />
        </div>
      </SettingsSection>

      <SettingsSection heading={t({ ko: '상위 그룹', en: 'Top groups' })}>
        <div className="space-y-2">
          {topGroups.length > 0 ? topGroups.map((group) => (
            <SettingsInsetBlock key={group.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-foreground">{group.group_name}</span>
              <Badge variant="secondary">{formatNumber(group.prompt_count ?? 0)}</Badge>
            </SettingsInsetBlock>
          )) : <SettingsInsetBlock className="px-3 py-4 text-sm text-muted-foreground">{t('prompts.components.prompt.summary.panel.no.group.statistics.to.show')}</SettingsInsetBlock>}
        </div>
      </SettingsSection>

      <SettingsSection heading={t({ ko: '상위 프롬프트', en: 'Top prompts' })} className="xl:col-span-2">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {topPrompts.length > 0 ? topPrompts.slice(0, 9).map((item) => (
            <SettingsInsetBlock key={`${item.type}-${item.id}`} className="px-3 py-2">
              <div className="truncate text-sm font-medium text-foreground">{item.prompt}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t({ ko: '사용량 {count}', en: 'usage {count}' }, { count: formatNumber(item.usage_count) })}</div>
            </SettingsInsetBlock>
          )) : <SettingsInsetBlock className="px-3 py-4 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{t('prompts.components.prompt.summary.panel.no.top.prompts.to.show')}</SettingsInsetBlock>}
        </div>
      </SettingsSection>
    </div>
  )
}
