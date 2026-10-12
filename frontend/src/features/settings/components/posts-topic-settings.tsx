import { Link } from 'react-router-dom'
import type { PostsTopicEvaluationSettings } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'

export function PostsTopicSettingsRows({ draft, onPatch }: { draft: PostsTopicEvaluationSettings; onPatch: (patch: Partial<PostsTopicEvaluationSettings>) => void }) {
  const { t } = useI18n()
  const limits = [
    { key: 'dailyCallLimit', ko: '계정당 하루 호출 한도', en: 'Daily calls per account', min: 0, max: 10000 },
    { key: 'dailyTokenLimit', ko: '계정당 하루 토큰 한도', en: 'Daily tokens per account', min: 0, max: 100000000 },
    { key: 'maxInputCharacters', ko: '평가 입력 글자 수', en: 'Evaluation input characters', min: 1000, max: 200000 },
    { key: 'maxRetries', ko: '일시 오류 재시도', en: 'Transient retries', min: 0, max: 10 },
  ] as const
  return (
    <RowGroup heading={t({ ko: '주제 관련도', en: 'Topic relevance' })}>
      <SettingsSwitchRow label={t({ ko: '새 글 발행 후 자동 평가', en: 'Evaluate newly published posts' })} checked={draft.autoEnabled} onCheckedChange={autoEnabled => onPatch({ autoEnabled })} />
      <SettingRow label={t({ ko: '평가 대상', en: 'Evaluation scope' })}><span className="text-sm text-muted-foreground">{t({ ko: '사람·봇의 공개 글 · 초안은 발행할 때 평가', en: 'Published human and bot posts · drafts are evaluated on publication' })}</span></SettingRow>
      <SettingsSwitchRow label={t({ ko: '제목·본문 수정 후 재평가', en: 'Re-evaluate title or body edits' })} checked={draft.reevaluateOnEdit} disabled={!draft.autoEnabled} onCheckedChange={reevaluateOnEdit => onPatch({ reevaluateOnEdit })} />
      <SettingRow label={t({ ko: '평가 주제와 판단 모델', en: 'Topics and judge model' })}><Button asChild variant="subtle" size="sm"><Link to="/settings?section=llm&view=content-evaluation">{t({ ko: '공통 평가 기준 관리', en: 'Manage shared criteria' })}</Link></Button></SettingRow>
      <SettingRow label={t({ ko: '목록에 표시할 최소 관련도 (%)', en: 'Minimum score shown in lists (%)' })} controlClassName={SETTINGS_CONTROL_CLASS}><NumberStepperInput aria-label={t({ ko: '목록에 표시할 최소 관련도 (%)', en: 'Minimum score shown in lists (%)' })} min={0} max={100} value={draft.minimumScore} variant="settings" onValueCommit={minimumScore => onPatch({ minimumScore: Number(minimumScore) })} /></SettingRow>
      <SettingRow label={t({ ko: '목록에 표시할 주제 수', en: 'Maximum topics shown in lists' })} controlClassName={SETTINGS_CONTROL_CLASS}><NumberStepperInput aria-label={t({ ko: '목록에 표시할 주제 수', en: 'Maximum topics shown in lists' })} min={1} max={20} value={draft.maximumTopics} variant="settings" onValueCommit={maximumTopics => onPatch({ maximumTopics: Number(maximumTopics) })} /></SettingRow>
      <details className="pt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t({ ko: '사용량과 실행 한도', en: 'Usage and execution limits' })}</summary>
        {limits.map(({ key, ko, en, min, max }) => <SettingRow key={key} label={t({ ko, en })} controlClassName={SETTINGS_CONTROL_CLASS}><NumberStepperInput aria-label={t({ ko: '주제 관련도 · ' + ko, en: 'Topic relevance · ' + en })} min={min} max={max} value={draft[key]} variant="settings" onValueCommit={value => onPatch({ [key]: Number(value) })} /></SettingRow>)}
        <p className="mt-3 text-xs text-muted-foreground">{t({ ko: '지식 문서 품질 평가와는 별도 한도야. 재시도도 호출 한도에 포함돼. 긴 글은 일부 본문 기준으로 표시해.', en: 'These limits are separate from knowledge quality reviews. Retries count toward usage. Long documents are marked as partially read.' })}</p>
      </details>
    </RowGroup>
  )
}
