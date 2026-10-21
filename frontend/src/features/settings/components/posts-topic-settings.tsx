import type { PostsTopicEvaluationSettings } from '@conai/shared'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Section } from '@/components/ui/section'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import type { useContentEvaluationSettings } from '../use-content-evaluation-settings'
import { ContentEvaluationSettingsRows } from './content-evaluation-settings'
import { useSettingsAdvanced } from './settings-advanced'

type Props = {
  draft: PostsTopicEvaluationSettings
  onPatch: (patch: Partial<PostsTopicEvaluationSettings>) => void
  criteria: ReturnType<typeof useContentEvaluationSettings>['tabProps']
}

/** Settings › 게시판 › 주제 관련도: posts automation and display (posts draft) around the shared judge and topics. */
export function PostsTopicSettings({ draft, onPatch, criteria }: Props) {
  const { t } = useI18n()
  const advanced = useSettingsAdvanced()
  const limits = [
    { key: 'dailyCallLimit', ko: '계정당 하루 호출', en: 'Daily calls per account', min: 0, max: 10000 },
    { key: 'dailyTokenLimit', ko: '계정당 하루 토큰', en: 'Daily tokens per account', min: 0, max: 100000000 },
    { key: 'maxInputCharacters', ko: '입력 글자 수', en: 'Input characters', min: 1000, max: 200000 },
    { key: 'maxRetries', ko: '재시도', en: 'Retries', min: 0, max: 10 },
  ] as const
  return (
    <ContentEvaluationSettingsRows
      {...criteria}
      leadingRows={<>
        <SettingsSwitchRow label={t({ ko: '새 글 자동 평가', en: 'Evaluate new posts' })} checked={draft.autoEnabled} onCheckedChange={autoEnabled => onPatch({ autoEnabled })} />
        <SettingsSwitchRow label={t({ ko: '수정하면 다시 평가', en: 'Re-evaluate after edits' })} checked={draft.reevaluateOnEdit} disabled={!draft.autoEnabled} onCheckedChange={reevaluateOnEdit => onPatch({ reevaluateOnEdit })} />
      </>}
      trailingRows={(
        <SettingRow label={t({ ko: '목록에 표시', en: 'Shown in lists' })}>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <NumberStepperInput className="w-32" variant="settings" aria-label={t({ ko: '표시할 최소 관련도 (%)', en: 'Minimum score shown (%)' })} min={0} max={100} value={draft.minimumScore} onValueCommit={minimumScore => onPatch({ minimumScore: Number(minimumScore) })} />
          <span>{t({ ko: '% 이상 · 최대', en: '% or more · up to' })}</span>
          <NumberStepperInput className="w-32" variant="settings" aria-label={t({ ko: '표시할 주제 수', en: 'Topics shown' })} min={1} max={20} value={draft.maximumTopics} onValueCommit={maximumTopics => onPatch({ maximumTopics: Number(maximumTopics) })} />
          <span>{t({ ko: '개', en: 'topics' })}</span>
          </div>
        </SettingRow>
      )}
      footer={advanced ? (
        <Section variant="settings" heading={t({ ko: '한도', en: 'Limits' })}>
          <div className="grid gap-x-10 sm:grid-cols-2">
          {limits.map(({ key, ko, en, min, max }) => (
            <SettingRow key={key} label={t({ ko, en })} controlClassName="w-36">
              <NumberStepperInput aria-label={t({ ko: '주제 관련도 · ' + ko, en: 'Topic relevance · ' + en })} min={min} max={max} value={draft[key]} variant="settings" onValueCommit={value => onPatch({ [key]: Number(value) })} />
            </SettingRow>
          ))}
          </div>
        </Section>
      ) : null}
    />
  )
}
