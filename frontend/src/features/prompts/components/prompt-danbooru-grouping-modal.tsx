import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, WandSparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { applyDanbooruPromptGrouping, getDanbooruPromptGroupingPreview } from '@/lib/api'
import type { DanbooruPromptGroupingTypeResult } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptDanbooruGroupingModalProps {
  open: boolean
  onClose: () => void
  onInfo: (message: string) => void
  onError: (message: string) => void
}

function TypeSummaryCard({ item }: { item: DanbooruPromptGroupingTypeResult }) {
  const { t, formatNumber } = useI18n()
  const matchRate = item.eligiblePrompts > 0 ? Math.round((item.matchedPrompts / item.eligiblePrompts) * 1000) / 10 : 0

  return (
    <div className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold capitalize text-foreground">{item.type}</div>
        <Badge variant="outline">{matchRate}%</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <div>{t({ ko: '대상', en: 'Eligible' })}</div>
          <div className="font-mono text-foreground">{formatNumber(item.eligiblePrompts)}</div>
        </div>
        <div>
          <div>{t({ ko: '매칭', en: 'Matched' })}</div>
          <div className="font-mono text-foreground">{formatNumber(item.matchedPrompts)}</div>
        </div>
        <div>
          <div>{t({ ko: '그룹', en: 'Groups' })}</div>
          <div className="font-mono text-foreground">{formatNumber(item.matchedGroups)}</div>
        </div>
        <div>
          <div>{t({ ko: '기존 분류 제외', en: 'Skipped assigned' })}</div>
          <div className="font-mono text-foreground">{formatNumber(item.skippedAssignedPrompts)}</div>
        </div>
      </div>
      {item.sampleUnmatchedPrompts.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          <div className="mb-1 font-medium">{t({ ko: '미매칭 예시', en: 'Unmatched examples' })}</div>
          <div className="line-clamp-2 break-words">{item.sampleUnmatchedPrompts.map((prompt) => prompt.prompt).join(', ')}</div>
        </div>
      ) : null}
    </div>
  )
}

export function PromptDanbooruGroupingModal({ open, onClose, onInfo, onError }: PromptDanbooruGroupingModalProps) {
  const { t, formatNumber } = useI18n()
  const queryClient = useQueryClient()
  const previewQuery = useQuery({
    queryKey: ['prompt-danbooru-grouping-preview', 'unclassified-only'],
    queryFn: () => getDanbooruPromptGroupingPreview('unclassified-only'),
    enabled: open,
  })

  const applyMutation = useMutation({
    mutationFn: () => applyDanbooruPromptGrouping('unclassified-only'),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['prompt-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-group-statistics'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-top'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-search'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-statistics'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-danbooru-grouping-preview'] }),
      ])
      onInfo(t({ ko: '단부루 기준 자동 그룹 구성이 완료됐어. {count}개 프롬프트를 배치했어.', en: 'Danbooru grouping complete. Assigned {count} prompts.' }, { count: formatNumber(result.totals.assignedPrompts) }))
      onClose()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : t({ ko: '단부루 기준 자동 그룹 구성에 실패했어.', en: 'Failed to apply Danbooru grouping.' }))
    },
  })

  const preview = previewQuery.data

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru-based group setup' })}
      description={t({ ko: 'Positive, Auto, Negative 3가지 수집 목록 모두에 적용해. 안전하게 기존 그룹이 없는 미분류 항목만 배치해.', en: 'Applies to Positive, Auto, and Negative collections. Safely assigns only unclassified prompts.' })}
      widthClassName="max-w-4xl"
    >
      <div className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t({ ko: '안전 모드', en: 'Safe mode' })}</AlertTitle>
          <AlertDescription>
            {t({ ko: '기존에 사람이 지정한 group_id는 덮어쓰지 않아. group_id가 비어 있는 프롬프트만 단부루 taxonomy 그룹으로 이동해.', en: 'Existing manual group assignments are not overwritten. Only prompts with an empty group_id are moved into Danbooru taxonomy groups.' })}
          </AlertDescription>
        </Alert>

        {previewQuery.isLoading ? (
          <div className="rounded-sm border border-border/70 bg-surface-container/35 p-6 text-sm text-muted-foreground">{t({ ko: '미리보기 계산 중...', en: 'Calculating preview...' })}</div>
        ) : null}

        {previewQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '미리보기 실패', en: 'Preview failed' })}</AlertTitle>
            <AlertDescription>{previewQuery.error instanceof Error ? previewQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-sm border border-border/70 bg-surface-low p-3">
                <div className="text-xs text-muted-foreground">{t({ ko: '대상 프롬프트', en: 'Eligible prompts' })}</div>
                <div className="mt-1 font-mono text-lg font-semibold">{formatNumber(preview.totals.eligiblePrompts)}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-surface-low p-3">
                <div className="text-xs text-muted-foreground">{t({ ko: '매칭 프롬프트', en: 'Matched prompts' })}</div>
                <div className="mt-1 font-mono text-lg font-semibold">{formatNumber(preview.totals.matchedPrompts)}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-surface-low p-3">
                <div className="text-xs text-muted-foreground">{t({ ko: '생성 기준 그룹', en: 'Matched groups' })}</div>
                <div className="mt-1 font-mono text-lg font-semibold">{formatNumber(preview.totals.matchedGroups)}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-surface-low p-3">
                <div className="text-xs text-muted-foreground">{t({ ko: '기존 분류 제외', en: 'Skipped assigned' })}</div>
                <div className="mt-1 font-mono text-lg font-semibold">{formatNumber(preview.totals.skippedAssignedPrompts)}</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {preview.byType.map((item) => <TypeSummaryCard key={item.type} item={item} />)}
            </div>

            <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
              <Button type="button" variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button type="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || preview.totals.matchedPrompts === 0}>
                <WandSparkles className="h-4 w-4" />
                {applyMutation.isPending ? t({ ko: '적용 중...', en: 'Applying...' }) : t({ ko: '자동 그룹 구성 적용', en: 'Apply auto grouping' })}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </SettingsModal>
  )
}
