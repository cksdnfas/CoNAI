import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_POSTS_KNOWLEDGE_SETTINGS, type PostsKnowledgeSettings } from '@conai/shared'
import { RefreshCw } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots } from '@/lib/api-codex-chat'
import { POSTS_QUERY_KEY, getPostKnowledgeEvaluationStatus, getPostKnowledgeSearchStatus } from '@/lib/api-posts'
import { cn } from '@/lib/utils'
import { ModelRowOptions } from './chat-model-role-select'
import { SETTINGS_CONTROL_CLASS, SettingsStatLine } from './settings-rows'

type NumberSettingKey = { [Key in keyof PostsKnowledgeSettings]: PostsKnowledgeSettings[Key] extends number ? Key : never }[keyof PostsKnowledgeSettings]
type NumberRow = { key: NumberSettingKey; ko: string; en: string; min: number; max: number; step?: number }

const ADVANCED_GROUPS: Array<{ ko: string; en: string; rows: NumberRow[] }> = [
  { ko: '한도', en: 'Limits', rows: [
    { key: 'dailyCallLimit', ko: '계정당 하루 호출', en: 'Daily calls per account', min: 0, max: 100000 },
    { key: 'dailyTokenLimit', ko: '계정당 하루 토큰', en: 'Daily tokens per account', min: 0, max: 100000000 },
    { key: 'maxDocumentsPerExecution', ko: '작업당 문서', en: 'Documents per execution', min: 1, max: 100 },
    { key: 'maxSegmentsPerDocument', ko: '문서당 근거 구간', en: 'Evidence segments per document', min: 1, max: 30 },
    { key: 'maxInputCharacters', ko: '입력 글자 수', en: 'Input characters', min: 100, max: 1000000 },
    { key: 'maxRetries', ko: '재시도', en: 'Retries', min: 0, max: 10 },
  ] },
  { ko: '자동 평가 상한', en: 'Automatic feedback caps', rows: [
    { key: 'aiBundleCap', ko: '같은 작업', en: 'Per execution', min: 0, max: 10, step: 0.05 },
    { key: 'aiDailyFamilyLimit', ko: '문서·계정·모델당 하루', en: 'Per document, account and model per day', min: 0, max: 100, step: 1 },
    { key: 'aiGlobalMinimumCap', ko: '사람 평가 없을 때', en: 'Without human feedback', min: 0, max: 100, step: 0.05 },
    { key: 'aiGlobalHumanRatio', ko: '사람 대비 비율', en: 'Ratio to human feedback', min: 0, max: 10, step: 0.05 },
    { key: 'historyWeight', ko: '이전 판 참고 비율', en: 'Earlier version weight', min: 0, max: 1, step: 0.05 },
    { key: 'historyCap', ko: '이전 판 참고 상한', en: 'Earlier version cap', min: 0, max: 100, step: 0.05 },
  ] },
  { ko: '보관 (일)', en: 'Retention (days)', rows: [
    { key: 'privateRetentionDays', ko: '작업 근거', en: 'Private evidence', min: 1, max: 3650 },
    { key: 'diagnosticRetentionDays', ko: '진단 자료', en: 'Diagnostics', min: 1, max: 3650 },
  ] },
]

const WEIGHT_ROWS: NumberRow[] = [
  { key: 'humanWeight', ko: '사람', en: 'People', min: 0, max: 10, step: 0.05 },
  { key: 'useAiWeight', ko: '사용 AI', en: 'Use AI', min: 0, max: 10, step: 0.05 },
  { key: 'judgeWeight', ko: '판단모델', en: 'Judge', min: 0, max: 10, step: 0.05 },
]

/** Settings › 게시판 › 지식 품질: knowledge features, the judge, feedback weights; limits and caps fold under 고급. */
export function PostsKnowledgeSettingsRows({ draft, onPatch }: { draft: PostsKnowledgeSettings; onPatch: (patch: Partial<PostsKnowledgeSettings>) => void }) {
  const { t } = useI18n()
  const models = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const status = useQuery({ queryKey: [POSTS_QUERY_KEY, 'evaluation-status'], queryFn: getPostKnowledgeEvaluationStatus, refetchInterval: (query) => query.state.data?.queued || query.state.data?.running ? 10000 : false })
  const search = useQuery({ queryKey: [POSTS_QUERY_KEY, 'knowledge-search-status'], queryFn: getPostKnowledgeSearchStatus, staleTime: 30_000 })
  const slot = models.data?.find((item) => item.providerName === draft.judgeProvider && item.model === draft.judgeModel)
  const modelValue = slot ? `slot:${slot.id}` : draft.judgeProvider && draft.judgeModel ? 'saved' : ''
  const ready = status.data && modelValue ? status.data.providerReady : null
  const readyLabel = ready ? t({ ko: '준비됨', en: 'Ready' }) : t({ ko: '준비 안 됨', en: 'Unavailable' })
  const searchLabel = search.data?.state === 'ready' ? t({ ko: '키워드 + 의미', en: 'Keyword + semantic' })
    : search.data?.state === 'partial' || search.data?.state === 'indexing' ? t({ ko: '키워드 · 의미 색인 {indexed} / {total}', en: 'Keyword · semantic index {indexed} / {total}' }, { indexed: search.data.indexed, total: search.data.total })
      : search.data?.state === 'unavailable' ? t({ ko: '키워드 · 의미 검색 준비 안 됨', en: 'Keyword · semantic unavailable' })
        : t({ ko: '키워드', en: 'Keyword' })
  return (
    <div className="space-y-8">
      {status.data ? (
        <SettingsStatLine className="justify-end text-xs tabular-nums" items={[
          { label: t({ ko: '대기', en: 'Queued' }), value: status.data.queued },
          { label: t({ ko: '실행', en: 'Running' }), value: status.data.running },
          { label: t({ ko: '실패', en: 'Failed' }), value: status.data.failed, tone: status.data.failed ? 'danger' : 'default' },
          { label: t({ ko: '오늘 호출', en: 'Calls today' }), value: `${status.data.todayCalls} / ${draft.dailyCallLimit}` },
          { label: t({ ko: '토큰', en: 'Tokens' }), value: `${status.data.todayTokens ?? t({ ko: '미보고', en: 'unreported' })} / ${draft.dailyTokenLimit}` },
        ]} />
      ) : status.isError ? <ErrorState size="compact" error={status.error} onRetry={() => void status.refetch()} /> : null}
      <RowGroup>
        <SettingsSwitchRow label={t({ ko: '지식 문서', en: 'Knowledge documents' })} checked={draft.enabled} onCheckedChange={(enabled) => onPatch({ enabled })} />
        <SettingsSwitchRow label={t({ ko: '검색에 평가 반영', en: 'Use feedback in search ranking' })} checked={draft.rankingEnabled} disabled={!draft.enabled} onCheckedChange={(rankingEnabled) => onPatch({ rankingEnabled })} />
        <SettingsSwitchRow label={t({ ko: '쓰고 나면 자동 평가', en: 'Evaluate automatically after use' })} checked={draft.autoEvaluationEnabled} disabled={!draft.enabled} onCheckedChange={(autoEvaluationEnabled) => onPatch({ autoEvaluationEnabled })} />
        <SettingRow label={t({ ko: '판단 모델', en: 'Judge model' })} controlClassName={cn(SETTINGS_CONTROL_CLASS, 'flex items-center gap-2')}>
          {ready !== null ? <span role="img" aria-label={readyLabel} title={readyLabel} className={cn('size-2 shrink-0 rounded-full', ready ? 'bg-success' : 'bg-warning')} /> : null}
          <Select variant="settings" aria-label={t({ ko: '판단 모델', en: 'Judge model' })} value={modelValue} disabled={!models.isSuccess || !draft.enabled} onChange={(event) => {
            const selected = models.data?.find((item) => `slot:${item.id}` === event.target.value)
            onPatch({ judgeProvider: selected?.providerName ?? null, judgeModel: selected?.model ?? null })
          }}>
            <option value="">{t({ ko: '사용 안 함', en: 'Off' })}</option>
            <ModelRowOptions slots={models.data ?? []} />
            {modelValue === 'saved' ? <option value="saved" disabled>{draft.judgeProvider} · {draft.judgeModel}</option> : null}
          </Select>
        </SettingRow>
        <SettingRow label={t({ ko: '검색', en: 'Search' })}><span className="text-sm tabular-nums text-muted-foreground">{searchLabel}</span></SettingRow>
        <SettingRow label={t({ ko: '평가 비중', en: 'Feedback weights' })} controlClassName="flex flex-wrap items-center gap-x-4 gap-y-2">
          {WEIGHT_ROWS.map((row) => (
            <label key={row.key} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              {t(row)}
              <NumberStepperInput className="w-32" min={row.min} max={row.max} step={row.step} variant="settings" aria-label={t({ ko: '{name} 평가 비중', en: '{name} weight' }, { name: t(row) })} value={draft[row.key]} onValueCommit={(value) => onPatch({ [row.key]: Number(value) })} />
            </label>
          ))}
        </SettingRow>
      </RowGroup>
      <Section
        variant="settings"
        heading={t({ ko: '고급', en: 'Advanced' })}
        collapsible
        defaultOpen={false}
        actions={<IconButton size="icon-sm" variant="ghost" label={t({ ko: '기본값으로 (정책 {version})', en: 'Restore defaults (policy {version})' }, { version: draft.policyVersion })} onClick={() => onPatch(DEFAULT_POSTS_KNOWLEDGE_SETTINGS)}><RefreshCw /></IconButton>}
        bodyClassName="grid gap-x-10 sm:grid-cols-2"
      >
        {ADVANCED_GROUPS.map((group) => (
          <Fragment key={group.ko}>
            <h4 className="col-span-full pb-1 pt-4 text-xs text-muted-foreground first:pt-0">{t(group)}</h4>
            {group.rows.map((row) => (
              <SettingRow key={row.key} label={t(row)} controlClassName="w-36">
                <NumberStepperInput min={row.min} max={row.max} step={row.step} variant="settings" aria-label={t(row)} value={draft[row.key]} onValueCommit={(value) => onPatch({ [row.key]: Number(value) })} />
              </SettingRow>
            ))}
          </Fragment>
        ))}
      </Section>
    </div>
  )
}
