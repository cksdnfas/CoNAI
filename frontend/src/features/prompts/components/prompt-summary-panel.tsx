import { SectionHeading } from '@/components/common/section-heading'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { PromptCollectionItem, PromptGroupRecord, PromptStatistics, PromptTypeFilter } from '@/types/prompt'
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
  const topGroups = [...groupStatistics]
    .filter((group) => group.id !== 0)
    .sort((left, right) => (right.prompt_count ?? 0) - (left.prompt_count ?? 0))
    .slice(0, 5)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section>
        <Card className="bg-surface-container">
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" heading={`${getTypeLabel(promptType)} 요약`} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-sm border border-border/70 bg-background/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current type total</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{getPromptTypeTotal(promptType, statistics).toLocaleString('ko-KR')}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-background/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">All positive</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{(statistics?.total_prompts ?? 0).toLocaleString('ko-KR')}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-background/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">All negative / auto</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{`${(statistics?.total_negative_prompts ?? 0).toLocaleString('ko-KR')} / ${(statistics?.total_auto_prompts ?? 0).toLocaleString('ko-KR')}`}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="bg-surface-container">
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" heading="Top groups" />
            <div className="space-y-2">
              {topGroups.length > 0 ? topGroups.map((group) => (
                <div key={group.id} className="flex items-center justify-between gap-3 rounded-sm border border-border/70 bg-background/50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{group.group_name}</span>
                  <Badge variant="secondary">{(group.prompt_count ?? 0).toLocaleString('ko-KR')}</Badge>
                </div>
              )) : <div className="rounded-sm border border-border/70 bg-background/50 px-3 py-4 text-sm text-muted-foreground">표시할 그룹 통계가 아직 없어.</div>}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="xl:col-span-2">
        <Card className="bg-surface-container">
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" heading="Top prompts" />
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {topPrompts.length > 0 ? topPrompts.slice(0, 9).map((item) => (
                <div key={`${item.type}-${item.id}`} className="rounded-sm border border-border/70 bg-background/50 px-3 py-2">
                  <div className="truncate text-sm font-medium text-foreground">{item.prompt}</div>
                  <div className="mt-1 text-xs text-muted-foreground">usage {item.usage_count.toLocaleString('ko-KR')}</div>
                </div>
              )) : <div className="rounded-sm border border-border/70 bg-background/50 px-3 py-4 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">표시할 상위 프롬프트가 아직 없어.</div>}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
