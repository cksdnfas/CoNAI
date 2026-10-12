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
import { ModelRowOptions } from './chat-model-role-select'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'

type NumberSettingKey = { [Key in keyof PostsKnowledgeSettings]: PostsKnowledgeSettings[Key] extends number ? Key : never }[keyof PostsKnowledgeSettings]

export function PostsKnowledgeSettingsRows({ draft, onPatch }: { draft: PostsKnowledgeSettings; onPatch: (patch: Partial<PostsKnowledgeSettings>) => void }) {
  const { t } = useI18n()
  const models = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const status = useQuery({ queryKey: [POSTS_QUERY_KEY, 'evaluation-status'], queryFn: getPostKnowledgeEvaluationStatus, refetchInterval: (query) => query.state.data?.queued || query.state.data?.running ? 10000 : false })
  const search = useQuery({ queryKey: [POSTS_QUERY_KEY, 'knowledge-search-status'], queryFn: getPostKnowledgeSearchStatus, staleTime: 30_000 })
  const slot = models.data?.find((item) => item.providerName === draft.judgeProvider && item.model === draft.judgeModel)
  const modelValue = slot ? `slot:${slot.id}` : draft.judgeProvider && draft.judgeModel ? 'saved' : ''
  const budgetRows: Array<{ key: NumberSettingKey; ko: string; en: string; min: number; max: number }> = [
    { key: 'dailyCallLimit', ko: '계정당 하루 호출 한도', en: 'Daily calls per account', min: 0, max: 100000 },
    { key: 'dailyTokenLimit', ko: '계정당 하루 토큰 한도', en: 'Daily tokens per account', min: 0, max: 100000000 },
    { key: 'maxDocumentsPerExecution', ko: '작업당 문서 수', en: 'Documents per execution', min: 1, max: 100 },
    { key: 'maxSegmentsPerDocument', ko: '문서당 근거 구간 수', en: 'Evidence segments per document', min: 1, max: 30 },
    { key: 'maxInputCharacters', ko: '평가 입력 글자 수', en: 'Evaluation input characters', min: 100, max: 1000000 },
    { key: 'maxRetries', ko: '평가 재시도 횟수', en: 'Evaluation retries', min: 0, max: 10 },
    { key: 'privateRetentionDays', ko: '비공개 작업 근거 보관일', en: 'Private evidence retention days', min: 1, max: 3650 },
    { key: 'diagnosticRetentionDays', ko: '평가 진단 자료 보관일', en: 'Diagnostic retention days', min: 1, max: 3650 },
  ]
  const policyRows: Array<{ key: NumberSettingKey; ko: string; en: string; max: number; step: number }> = [
    { key: 'humanWeight', ko: '사람 평가 기여', en: 'Human feedback weight', max: 10, step: 0.05 },
    { key: 'useAiWeight', ko: '사용 AI 평가 기여', en: 'Use AI weight', max: 10, step: 0.05 },
    { key: 'judgeWeight', ko: '판단모델 평가 기여', en: 'Judge weight', max: 10, step: 0.05 },
    { key: 'aiBundleCap', ko: '같은 작업의 자동 평가 기여 상한', en: 'Automatic weight per execution', max: 10, step: 0.05 },
    { key: 'aiDailyFamilyLimit', ko: '문서·계정·모델 계열당 일일 작업 상한', en: 'Daily executions per document, account and model family', max: 100, step: 1 },
    { key: 'aiGlobalMinimumCap', ko: '사람 평가가 없을 때 자동 평가 상한', en: 'Automatic cap without human feedback', max: 100, step: 0.05 },
    { key: 'aiGlobalHumanRatio', ko: '사람 평가량 대비 자동 평가 상한 비율', en: 'Automatic cap relative to human feedback', max: 10, step: 0.05 },
    { key: 'historyWeight', ko: '이전 판 참고 비율', en: 'Earlier version weight', max: 1, step: 0.05 },
    { key: 'historyCap', ko: '이전 판 참고 상한', en: 'Earlier version cap', max: 100, step: 0.05 },
  ]
  return (
    <>
      <RowGroup heading={t({ ko: '지식 문서', en: 'Knowledge documents' })}>
        <SettingsSwitchRow label={t({ ko: '지식 기능', en: 'Knowledge features' })} checked={draft.enabled} onCheckedChange={(enabled) => onPatch({ enabled })} />
        <SettingsSwitchRow label={t({ ko: '검색에 평가 반영', en: 'Use feedback in search ranking' })} checked={draft.rankingEnabled} disabled={!draft.enabled} onCheckedChange={(rankingEnabled) => onPatch({ rankingEnabled })} />
        <SettingsSwitchRow label={t({ ko: '사용 후 자동 평가', en: 'Automatic evaluations after use' })} checked={draft.autoEvaluationEnabled} disabled={!draft.enabled} onCheckedChange={(autoEvaluationEnabled) => onPatch({ autoEvaluationEnabled })} />
        <SettingRow label={t({ ko: '판단모델', en: 'Judge model' })} controlClassName={SETTINGS_CONTROL_CLASS}>
          <Select variant="settings" aria-label={t({ ko: '판단모델', en: 'Judge model' })} value={modelValue} disabled={!models.isSuccess || !draft.enabled} onChange={(event) => {
            const selected = models.data?.find((item) => `slot:${item.id}` === event.target.value)
            onPatch({ judgeProvider: selected?.providerName ?? null, judgeModel: selected?.model ?? null })
          }}>
            <option value="">{t({ ko: '사용 안 함', en: 'Off' })}</option>
            <ModelRowOptions slots={models.data ?? []} />
            {modelValue === 'saved' ? <option value="saved" disabled>{draft.judgeProvider} · {draft.judgeModel}</option> : null}
          </Select>
        </SettingRow>
        <SettingRow label={t({ ko: '검색 상태', en: 'Search status' })}><span className="text-sm text-muted-foreground">{search.data?.state === 'ready' ? t({ ko: '키워드 + 의미 검색', en: 'Keyword + semantic search' }) : search.data?.state === 'partial' || search.data?.state === 'indexing' ? t({ ko: '키워드 검색 · 의미 색인 {indexed}/{total}', en: 'Keyword search · semantic index {indexed}/{total}' }, { indexed: search.data.indexed, total: search.data.total }) : search.data?.state === 'unavailable' ? t({ ko: '키워드 검색 · 의미 검색 준비 안 됨', en: 'Keyword search · semantic search unavailable' }) : t({ ko: '키워드 검색', en: 'Keyword search' })}</span></SettingRow>
      </RowGroup>
      <RowGroup heading={t({ ko: '평가 실행과 사용량', en: 'Evaluation activity and usage' })}>
        <SettingRow label={t({ ko: '실행 상태', en: 'Runtime status' })}><span className="text-sm text-muted-foreground">{status.data ? status.data.providerReady ? t({ ko: '판단모델 준비됨', en: 'Judge is ready' }) : t({ ko: '판단모델 준비 안 됨', en: 'Judge unavailable' }) : t({ ko: '상태 확인 중', en: 'Checking status' })}</span></SettingRow>
        {status.data ? <>
          <SettingRow label={t({ ko: '평가 대기 · 실행 · 실패', en: 'Queued · running · failed' })}><span className="text-sm tabular-nums text-muted-foreground">{status.data.queued} · {status.data.running} · {status.data.failed}</span></SettingRow>
          <SettingRow label={t({ ko: '오늘 계정 호출', en: 'Calls today for this account' })}><span className="text-sm tabular-nums text-muted-foreground">{status.data.todayCalls} / {draft.dailyCallLimit}</span></SettingRow>
          <SettingRow label={t({ ko: '오늘 실제 토큰', en: 'Reported tokens today' })}><span className="text-sm tabular-nums text-muted-foreground">{status.data.todayTokens ?? t({ ko: '미보고', en: 'Unreported' })} / {draft.dailyTokenLimit}{status.data.tokensUnreported ? ` · ${t({ ko: '미보고 호출 {count}', en: '{count} calls unreported' }, { count: status.data.tokensUnreported })}` : ''}</span></SettingRow>
          <SettingRow label={t({ ko: '예약한 토큰', en: 'Reserved tokens' })}><span className="text-sm tabular-nums text-muted-foreground">{status.data.todayReservedTokens}</span></SettingRow>
        </> : null}
        {status.isError ? <ErrorState size="compact" error={status.error} onRetry={() => void status.refetch()} /> : null}
      </RowGroup>
      <RowGroup heading={t({ ko: '평가 한도와 보관', en: 'Evaluation limits and retention' })} actions={<IconButton size="icon-sm" variant="ghost" label={t({ ko: '지식 설정 초기값', en: 'Restore knowledge defaults' })} onClick={() => onPatch(DEFAULT_POSTS_KNOWLEDGE_SETTINGS)}><RefreshCw /></IconButton>}>
        {budgetRows.map((row) => <SettingRow key={row.key} label={t(row)} controlClassName={SETTINGS_CONTROL_CLASS}><NumberStepperInput min={row.min} max={row.max} variant="settings" aria-label={t(row)} value={draft[row.key]} onValueCommit={(value) => onPatch({ [row.key]: Number(value) })} /></SettingRow>)}
      </RowGroup>
      <Section variant="settings" heading={t({ ko: '평가 집계 정책 {version}', en: 'Feedback policy {version}' }, { version: draft.policyVersion })} collapsible defaultOpen={false} bodyClassName="space-y-0">
        {policyRows.map((row) => <SettingRow key={row.key} label={t(row)} controlClassName={SETTINGS_CONTROL_CLASS}><NumberStepperInput min={0} max={row.max} step={row.step} variant="settings" aria-label={t(row)} value={draft[row.key]} onValueCommit={(value) => onPatch({ [row.key]: Number(value) })} /></SettingRow>)}
      </Section>
    </>
  )
}
