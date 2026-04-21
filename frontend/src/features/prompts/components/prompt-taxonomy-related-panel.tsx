import { Copy, Sparkles } from 'lucide-react'
import { PageSection } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PromptTaxonomyInferredType, PromptTaxonomyRelatedItem, PromptTaxonomyRelatedPayload, PromptTypeFilter } from '@/types/prompt'

interface ActivePromptSummary {
  prompt: string
  type: PromptTypeFilter
}

interface PromptTaxonomyRelatedPanelProps {
  activePrompt: ActivePromptSummary | null
  data?: PromptTaxonomyRelatedPayload
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onSelectPrompt: (prompt: string) => void
  onCopyPrompt: (prompt: string) => void
}

const INFERRED_TYPE_LABEL: Record<PromptTaxonomyInferredType, string> = {
  quality: 'Quality',
  subject: 'Subject',
  count_or_composition: 'Count',
  pose_or_action: 'Pose',
  body_or_expression: 'Body',
  hair_or_face: 'Hair',
  clothing_or_accessory: 'Clothing',
  prop_or_object: 'Object',
  background_or_setting: 'Background',
  lighting_or_mood: 'Lighting',
  style: 'Style',
  artist_or_source: 'Artist',
  meta_or_technical: 'Meta',
  unknown: 'Unknown',
}

function groupTaxonomyItems(items: PromptTaxonomyRelatedItem[]) {
  return {
    family: items.filter((item) => item.relation_kind === 'same_family'),
    variant: items.filter((item) => item.relation_kind === 'string_variant'),
  }
}

function TaxonomyItemCard({ item, onSelectPrompt, onCopyPrompt }: { item: PromptTaxonomyRelatedItem; onSelectPrompt: (prompt: string) => void; onCopyPrompt: (prompt: string) => void }) {
  return (
    <div className="flex min-w-0 items-stretch gap-2 rounded-sm border border-border/70 bg-surface-low/50 p-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start justify-center rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-high hover:text-foreground"
        onClick={() => onSelectPrompt(item.prompt)}
        title={item.prompt}
      >
        <span className="line-clamp-2 break-all text-sm font-semibold text-foreground">{item.prompt}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{INFERRED_TYPE_LABEL[item.inferred_type]}</span>
          <span>{item.usage_count.toLocaleString('ko-KR')}</span>
          <span>{item.score.toFixed(2)}</span>
        </span>
      </button>

      <div className="flex shrink-0 flex-col justify-center gap-1">
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => onCopyPrompt(item.prompt)} aria-label={`${item.prompt} 복사`} title="복사">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => onSelectPrompt(item.prompt)} aria-label={`${item.prompt} 보기`} title="보기">
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function PromptTaxonomyRelatedPanel({
  activePrompt,
  data,
  isLoading,
  isError,
  errorMessage,
  onSelectPrompt,
  onCopyPrompt,
}: PromptTaxonomyRelatedPanelProps) {
  const grouped = groupTaxonomyItems(data?.items ?? [])

  return (
    <PageSection
      title="Taxonomy"
      actions={
        <div className="flex items-center gap-2">
          {data?.source?.inferred_type ? <Badge variant="outline">{INFERRED_TYPE_LABEL[data.source.inferred_type]}</Badge> : null}
          {activePrompt ? <Badge variant="outline" className="max-w-full truncate">{activePrompt.prompt}</Badge> : null}
        </div>
      }
      bodyClassName="space-y-3"
    >
      {!activePrompt ? <div className="text-sm text-muted-foreground">프롬프트 선택</div> : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>taxonomy 추천을 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage ?? '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-sm" />
          ))}
        </div>
      ) : null}

      {!isLoading && activePrompt && !isError && (data?.items.length ?? 0) === 0 ? (
        <div className="text-sm text-muted-foreground">항목 없음</div>
      ) : null}

      {!isLoading && activePrompt && !isError && (data?.items.length ?? 0) > 0 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Family</Badge>
              <span className="text-xs text-muted-foreground">{grouped.family.length.toLocaleString('ko-KR')}</span>
            </div>
            {grouped.family.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.family.map((item) => (
                  <TaxonomyItemCard key={`family:${item.id}:${item.prompt}`} item={item} onSelectPrompt={onSelectPrompt} onCopyPrompt={onCopyPrompt} />
                ))}
              </div>
            ) : <div className="text-sm text-muted-foreground">항목 없음</div>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Variant</Badge>
              <span className="text-xs text-muted-foreground">{grouped.variant.length.toLocaleString('ko-KR')}</span>
            </div>
            {grouped.variant.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.variant.map((item) => (
                  <TaxonomyItemCard key={`variant:${item.id}:${item.prompt}`} item={item} onSelectPrompt={onSelectPrompt} onCopyPrompt={onCopyPrompt} />
                ))}
              </div>
            ) : <div className="text-sm text-muted-foreground">항목 없음</div>}
          </div>
        </div>
      ) : null}
    </PageSection>
  )
}
