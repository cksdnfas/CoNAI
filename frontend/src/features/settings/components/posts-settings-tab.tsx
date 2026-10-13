import { RefreshCw } from 'lucide-react'
import { DEFAULT_POSTS_SETTINGS, POSTS_SAFETY_LIMITS, type PostListLayout, type PostsSafetySettings, type PostsSettings } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import { SectionDirtyBadge } from './settings-section-status'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'
import { PostsKnowledgeSettingsRows } from './posts-knowledge-settings'
import { PostsTopicSettings } from './posts-topic-settings'
import { useSearchParams } from 'react-router-dom'
import { TextTabs } from '@/components/common/text-tabs'
import { TabsContent } from '@/components/ui/tabs'
import type { useContentEvaluationSettings } from '../use-content-evaluation-settings'

type PostsSettingsView = 'general' | 'topics' | 'knowledge'

/** `?view=` of the posts tab; no value means the general rows. */
function parseView(raw: string | null): PostsSettingsView {
  return raw === 'topics' || raw === 'knowledge' ? raw : 'general'
}

type NumericSafetyKey = Exclude<keyof PostsSafetySettings, 'summonEnabled'>

/**
 * Settings › 게시판, as text tabs: 일반 (list layout, bot posts, bot-call limits), 주제 관련도 (posts automation plus the
 * shared topic criteria draft) and 지식 품질 (knowledge documents and their feedback).
 */
export function PostsSettingsTab({ draft, onPatch, dirty, contentEvaluation }: {
  draft: PostsSettings | null
  onPatch: (patch: Omit<Partial<PostsSettings>, 'safety'> & { safety?: Partial<PostsSafetySettings> }) => void
  dirty: boolean
  contentEvaluation: ReturnType<typeof useContentEvaluationSettings>['tabProps']
}) {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseView(searchParams.get('view'))
  const setView = (next: string) => {
    const target = parseView(next)
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (target === 'general') params.delete('view')
      else params.set('view', target)
      return params
    }, { replace: true })
  }
  if (!draft) {
    return (
      <RowGroup heading={t({ ko: '게시판', en: 'Posts' })}>
        <SettingsRowsSkeleton rows={4} />
      </RowGroup>
    )
  }
  const limitRows: Array<{ key: NumericSafetyKey; label: string }> = [
    { key: 'chainDepth', label: t({ ko: '봇이 봇을 부르는 단계', en: 'Bot-to-bot call depth' }) },
    { key: 'botsPerComment', label: t({ ko: '댓글 하나에 부를 봇 수', en: 'Bots per comment' }) },
    { key: 'repliesPerPostPerHour', label: t({ ko: '글 하나의 시간당 봇 답글', en: 'Bot replies per post per hour' }) },
    { key: 'callsPerProfilePerDay', label: t({ ko: '봇 하나의 하루 호출', en: 'Calls per bot per day' }) },
    { key: 'summonsPerAccountPerHour', label: t({ ko: '계정 하나의 시간당 호출', en: 'Calls per account per hour' }) },
  ]
  return (
    <TextTabs
      value={view}
      onChange={setView}
      className="gap-6"
      actions={<SectionDirtyBadge dirty={dirty || contentEvaluation.dirty} />}
      items={[
        { value: 'general', label: t({ ko: '일반', en: 'General' }) },
        { value: 'topics', label: t({ ko: '주제 관련도', en: 'Topic relevance' }) },
        { value: 'knowledge', label: t({ ko: '지식 품질', en: 'Knowledge quality' }) },
      ]}
    >
      <TabsContent value="general">
        <div className="space-y-8">
          <RowGroup heading={t({ ko: '게시판', en: 'Posts' })}>
            <SettingRow label={t({ ko: '기본 목록 모양', en: 'Default list layout' })} controlClassName={SETTINGS_CONTROL_CLASS}>
              <Select variant="settings" aria-label={t({ ko: '기본 목록 모양', en: 'Default list layout' })} value={draft.layout} onChange={(event) => onPatch({ layout: event.target.value as PostListLayout })}>
                <option value="feed">{t({ ko: '피드', en: 'Feed' })}</option>
                <option value="cards">{t({ ko: '카드', en: 'Cards' })}</option>
                <option value="sns">{t({ ko: 'SNS', en: 'SNS' })}</option>
              </Select>
            </SettingRow>
            <SettingRow label={t({ ko: '봇이 쓴 글', en: 'Posts written by bots' })} controlClassName={SETTINGS_CONTROL_CLASS}>
              <Select variant="settings" aria-label={t({ ko: '봇이 쓴 글', en: 'Posts written by bots' })} value={draft.botPostStatus} onChange={(event) => onPatch({ botPostStatus: event.target.value as PostsSettings['botPostStatus'] })}>
                <option value="published">{t({ ko: '바로 발행', en: 'Publish right away' })}</option>
                <option value="draft">{t({ ko: '초안으로 두기', en: 'Keep as draft' })}</option>
              </Select>
            </SettingRow>
          </RowGroup>
          <RowGroup
            heading={t({ ko: '댓글로 봇 부르기', en: 'Calling bots from comments' })}
            actions={(
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '초기값으로 되돌리기', en: 'Restore defaults' })} onClick={() => onPatch({ safety: DEFAULT_POSTS_SETTINGS.safety })}>
                <RefreshCw className="h-4 w-4" />
              </IconButton>
            )}
          >
            <SettingsSwitchRow
              label={t({ ko: '봇 부르기', en: 'Bot calls' })}
              checked={draft.safety.summonEnabled}
              onCheckedChange={(checked) => onPatch({ safety: { summonEnabled: checked } })}
            />
            {limitRows.map((row) => (
              <SettingRow key={row.key} label={row.label} controlClassName={SETTINGS_CONTROL_CLASS}>
                <NumberStepperInput
                  min={POSTS_SAFETY_LIMITS[row.key].min}
                  max={POSTS_SAFETY_LIMITS[row.key].max}
                  variant="settings"
                  aria-label={row.label}
                  value={draft.safety[row.key]}
                  disabled={!draft.safety.summonEnabled}
                  onValueCommit={(value) => onPatch({ safety: { [row.key]: Number(value) || POSTS_SAFETY_LIMITS[row.key].min } })}
                />
              </SettingRow>
            ))}
          </RowGroup>
        </div>
      </TabsContent>
      <TabsContent value="topics">
        <PostsTopicSettings draft={draft.topicEvaluation} onPatch={(patch) => onPatch({ topicEvaluation: { ...draft.topicEvaluation, ...patch } })} criteria={contentEvaluation} />
      </TabsContent>
      <TabsContent value="knowledge">
        <PostsKnowledgeSettingsRows draft={draft.knowledge} onPatch={(patch) => onPatch({ knowledge: { ...draft.knowledge, ...patch } })} />
      </TabsContent>
    </TextTabs>
  )
}
