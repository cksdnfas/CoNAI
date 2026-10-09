import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EditorGroup } from '@/components/ui/editor-group'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { applyDanbooruPromptGrouping, getDanbooruPromptGroupingPreview } from '@/lib/api-prompts'
import type { DanbooruPromptGroupingTypeResult } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { useCanSeeServerDetails } from '../use-can-see-server-details'

interface PromptDanbooruGroupingModalProps {
  open: boolean
  onClose: () => void
  onInfo: (message: string) => void
  onError: (message: string) => void
}

/** One total as "label value" in the numbers line. */
function Total({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span> <span className="font-mono font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  )
}

/** One Danbooru tag type as a hairline row: its match rate, the counts in one line, and unmatched examples. */
function TypeSummaryRow({ item }: { item: DanbooruPromptGroupingTypeResult }) {
  const { t, formatNumber } = useI18n()
  const matchRate = item.eligiblePrompts > 0 ? Math.round((item.matchedPrompts / item.eligiblePrompts) * 1000) / 10 : 0

  return (
    <div className="space-y-1 border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold capitalize text-foreground">{item.type}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{matchRate}%</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <Total label={t({ ko: '대상', en: 'Eligible' })} value={formatNumber(item.eligiblePrompts)} />
        <Total label={t({ ko: '매칭', en: 'Matched' })} value={formatNumber(item.matchedPrompts)} />
        <Total label={t({ ko: '그룹', en: 'Groups' })} value={formatNumber(item.matchedGroups)} />
        <Total label={t({ ko: '제외', en: 'Skipped' })} value={formatNumber(item.skippedAssignedPrompts)} />
      </div>
      {item.sampleUnmatchedPrompts.length > 0 ? (
        <div className="line-clamp-2 break-words text-xs text-muted-foreground">
          <span className="font-medium">{t({ ko: '미매칭 예시', en: 'Unmatched examples' })}</span> {item.sampleUnmatchedPrompts.map((prompt) => prompt.prompt).join(', ')}
        </div>
      ) : null}
    </div>
  )
}

export function PromptDanbooruGroupingModal({ open, onClose, onInfo, onError }: PromptDanbooruGroupingModalProps) {
  const { t, formatNumber, language } = useI18n()
  const canSeeServerDetails = useCanSeeServerDetails()
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
    <Modal
      open={open}
      onClose={onClose}
      title={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru-based group setup' })}
      size="normal"
      height="tall"
    >
      <div className="space-y-4">
        <div className="border-b border-line">
          <SettingsSwitchRow
            label={t({ ko: '사용자가 직접 분류한 태그도 포함', en: 'Include manually classified tags' })}
            checked={includeAssignedPrompts}
            onCheckedChange={setIncludeAssignedPrompts}
          />
        </div>

        {previewQuery.isLoading ? (
          <LoadingState label={t({ ko: '미리보기 계산 중…', en: 'Calculating preview…' })} />
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
                    {canSeeServerDetails ? (
                      <>
                        <p className="break-all font-mono text-xs text-foreground">{preview.database.expectedPath}</p>
                        <a className="block break-all text-xs text-primary underline-offset-4 hover:underline" href={preview.database.downloadUrl} target="_blank" rel="noreferrer">{preview.database.downloadUrl}</a>
                        <p className="text-xs">{t({ ko: '다른 위치는 DANBOORU_SQLITE_PATH 환경변수로 지정 가능해.', en: 'Set DANBOORU_SQLITE_PATH to use another location.' })}</p>
                      </>
                    ) : (
                      <p className="text-xs">{t({ ko: '관리자에게 Danbooru DB 파일 설치를 요청해.', en: 'Ask an administrator to install the Danbooru DB file.' })}</p>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <Total label={t({ ko: '대상 프롬프트', en: 'Eligible prompts' })} value={formatNumber(preview.totals.eligiblePrompts)} />
              <Total label={t({ ko: '매칭 프롬프트', en: 'Matched prompts' })} value={formatNumber(preview.totals.matchedPrompts)} />
              <Total label={t({ ko: '생성 기준 그룹', en: 'Matched groups' })} value={formatNumber(preview.totals.matchedGroups)} />
              <Total label={t({ ko: '기존 분류 제외', en: 'Skipped assigned' })} value={formatNumber(preview.totals.skippedAssignedPrompts)} />
            </div>

            <EditorGroup label={t({ ko: '종류별', en: 'By type' })}>
              <div>
                {preview.byType.map((item) => <TypeSummaryRow key={item.type} item={item} />)}
              </div>
            </EditorGroup>
          </>
        ) : null}
      </div>

      {preview ? (
        <ModalFooter className="mt-4 gap-1 border-t border-line pt-3">
          <span className="flex-1" />
          <Button type="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || !isDanbooruDbAvailable || preview.totals.matchedPrompts === 0}>
            <WandSparkles className="h-4 w-4" />
            {applyMutation.isPending ? t({ ko: '적용 중...', en: 'Applying...' }) : t({ ko: '자동 그룹 구성 적용', en: 'Apply auto grouping' })}
          </Button>
        </ModalFooter>
      ) : null}
    </Modal>
  )
}
