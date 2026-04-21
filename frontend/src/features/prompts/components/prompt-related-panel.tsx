import { Copy, RefreshCw, Sparkles } from 'lucide-react'
import { PageSection } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { PromptRelatedItem, PromptTypeFilter } from '@/types/prompt'

interface ActivePromptSummary {
  prompt: string
  type: PromptTypeFilter
}

interface PromptRelatedPanelProps {
  activePrompt: ActivePromptSummary | null
  items: PromptRelatedItem[]
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  isRebuilding?: boolean
  onRebuild?: () => void
  onSelectPrompt: (prompt: string) => void
  onCopyPrompt: (prompt: string) => void
}

export function PromptRelatedPanel({
  activePrompt,
  items,
  isLoading,
  isError,
  errorMessage,
  isRebuilding = false,
  onRebuild,
  onSelectPrompt,
  onCopyPrompt,
}: PromptRelatedPanelProps) {
  return (
    <PageSection
      title="Related"
      actions={
        <div className="flex items-center gap-2">
          {activePrompt ? <Badge variant="outline" className="max-w-full truncate">{activePrompt.prompt}</Badge> : null}
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => onRebuild?.()}
            disabled={!onRebuild || isRebuilding}
            aria-label="프롬프트 관계 재구축"
            title="관계 재구축"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRebuilding ? 'animate-spin' : null)} />
          </Button>
        </div>
      }
      bodyClassName="space-y-3"
    >
      {!activePrompt ? <div className="text-sm text-muted-foreground">프롬프트 선택</div> : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>연관 프롬프트를 불러오지 못했어</AlertTitle>
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

      {!isLoading && activePrompt && !isError && items.length === 0 ? (
        <div className="text-sm text-muted-foreground">항목 없음</div>
      ) : null}

      {!isLoading && activePrompt && !isError && items.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={`${activePrompt.type}:${item.id}:${item.prompt}`} className="flex min-w-0 items-stretch gap-2 rounded-sm border border-border/70 bg-surface-low/50 p-2">
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-start justify-center rounded-sm px-2 py-1.5 text-left transition-colors',
                  'hover:bg-surface-high hover:text-foreground',
                )}
                onClick={() => onSelectPrompt(item.prompt)}
                title={item.prompt}
              >
                <span className="line-clamp-2 break-all text-sm font-semibold text-foreground">{item.prompt}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{item.usage_count.toLocaleString('ko-KR')}</span>
                  <span>{item.shared_count.toLocaleString('ko-KR')}</span>
                  <span>{item.score.toFixed(2)}</span>
                </span>
              </button>

              <div className="flex shrink-0 flex-col justify-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onCopyPrompt(item.prompt)}
                  aria-label={`${item.prompt} 복사`}
                  title="복사"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onSelectPrompt(item.prompt)}
                  aria-label={`${item.prompt} 보기`}
                  title="보기"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </PageSection>
  )
}
