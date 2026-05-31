import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { applyDanbooruPromptGrouping, getDanbooruPromptGroupingPreview } from '@/lib/api-prompts'
import type { DanbooruPromptGroupingTypeResult } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptDanbooruGroupingModalProps {
  open: boolean
  onClose: () => void
  onInfo: (message: string) => void
  onError: (message: string) => void
}

function PreviewMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border/75 bg-surface-container/70 px-3 py-2.5">
      <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold leading-none text-foreground">{value}</div>
    </div>
  )
}

function TypeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-low px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function TypeSummaryCard({ item }: { item: DanbooruPromptGroupingTypeResult }) {
  const { t, formatNumber } = useI18n()
  const matchRate = item.eligiblePrompts > 0 ? Math.round((item.matchedPrompts / item.eligiblePrompts) * 1000) / 10 : 0

  return (
    <div className="rounded-sm border border-border/75 bg-surface-container/55 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold capitalize text-foreground">{item.type}</div>
        <Badge variant="outline" className="shrink-0 font-mono">{matchRate}%</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border/70 bg-border/70 text-xs sm:grid-cols-4">
        <TypeMetric label={t({ ko: '대상', en: 'Eligible' })} value={formatNumber(item.eligiblePrompts)} />
        <TypeMetric label={t({ ko: '매칭', en: 'Matched' })} value={formatNumber(item.matchedPrompts)} />
        <TypeMetric label={t({ ko: '그룹', en: 'Groups' })} value={formatNumber(item.matchedGroups)} />
        <TypeMetric label={t({ ko: '제외', en: 'Skipped' })} value={formatNumber(item.skippedAssignedPrompts)} />
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
  const { t, formatNumber, language } = useI18n()
  const queryClient = useQueryClient()
  const [includeAssignedPrompts, setIncludeAssignedPrompts] = useState(false)
  const groupingMode = includeAssignedPrompts ? 'overwrite-existing' : 'unclassified-only'
  const previewQuery = useQuery({
    queryKey: ['prompt-danbooru-grouping-preview', groupingMode, language, includeAssignedPrompts],
    queryFn: () => getDanbooruPromptGroupingPreview({ mode: groupingMode, language, includeAssignedPrompts }),
    enabled: open,
  })

  const applyMutation = useMutation({
    mutationFn: () => applyDanbooruPromptGrouping({ mode: groupingMode, language, includeAssignedPrompts }),
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
  const isDanbooruDbAvailable = preview?.database.available !== false

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru-based group setup' })}
      widthClassName="max-w-4xl"
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-sm border border-border/75 bg-surface-container/70 px-3 py-2.5 text-sm transition-colors hover:bg-surface-high/70">
          <span className="font-medium text-foreground">{t({ ko: '사용자가 직접 분류한 태그도 포함', en: 'Include manually classified tags' })}</span>
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={includeAssignedPrompts} onChange={(event) => setIncludeAssignedPrompts(event.target.checked)} />
        </label>

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
            {!isDanbooruDbAvailable ? (
              <Alert>
                <AlertTitle>{t({ ko: 'Danbooru DB 파일 없음', en: 'Danbooru DB file missing' })}</AlertTitle>
                <AlertDescription>
                  <div className="space-y-1">
                    <p>{t({ ko: '자동 그룹 구성은 DB 파일이 있어야 실행돼.', en: 'Auto grouping requires the DB file.' })}</p>
                    <p className="break-all font-mono text-xs text-foreground">{preview.database.expectedPath}</p>
                    <a className="block break-all text-xs text-primary underline-offset-4 hover:underline" href={preview.database.downloadUrl} target="_blank" rel="noreferrer">{preview.database.downloadUrl}</a>
                    <p className="text-xs">{t({ ko: '다른 위치는 DANBOORU_SQLITE_PATH 환경변수로 지정 가능해.', en: 'Set DANBOORU_SQLITE_PATH to use another location.' })}</p>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PreviewMetricCard label={t({ ko: '대상 프롬프트', en: 'Eligible prompts' })} value={formatNumber(preview.totals.eligiblePrompts)} />
              <PreviewMetricCard label={t({ ko: '매칭 프롬프트', en: 'Matched prompts' })} value={formatNumber(preview.totals.matchedPrompts)} />
              <PreviewMetricCard label={t({ ko: '생성 기준 그룹', en: 'Matched groups' })} value={formatNumber(preview.totals.matchedGroups)} />
              <PreviewMetricCard label={t({ ko: '기존 분류 제외', en: 'Skipped assigned' })} value={formatNumber(preview.totals.skippedAssignedPrompts)} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {preview.byType.map((item) => <TypeSummaryCard key={item.type} item={item} />)}
            </div>

            <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
              <Button type="button" variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button type="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || !isDanbooruDbAvailable || preview.totals.matchedPrompts === 0}>
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
