import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { FieldInfo } from '@/components/ui/field'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import {
  DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS,
  PROMPT_INLINE_SYNTAX_SOURCE_LABELS,
  PROMPT_INLINE_TRIGGERS,
  type PromptInlineSyntaxSettings,
  type PromptInlineSyntaxSource,
  type PromptInlineTrigger,
  usePromptInlineSyntaxSettings,
} from './prompt-inline-syntax-settings'

const HELP_ITEMS = [
  { syntax: '@ · Ctrl+Space', ko: '와일드카드·태그 그룹·내 그룹을 고르는 팔레트를 열어.', en: 'Open the palette of wildcards, tag groups and your groups.' },
  { syntax: '__Wildcard__', ko: '와일드카드 항목을 랜덤 출력해.', en: 'Output a random wildcard entry.' },
  { syntax: '__Wildcard|2__', ko: '와일드카드에서 서로 다른 항목 2개를 출력해.', en: 'Output two different wildcard entries.' },
  { syntax: '__tag:Group__', ko: '단부루 태그 그룹에서 랜덤 1개를 출력해.', en: 'Output one random tag from the Danbooru group.' },
  { syntax: '__tag:Group|3__', ko: '그룹에서 정확히 3개를 출력해.', en: 'Output exactly three tags from the group.' },
  { syntax: '__tag:Group|0-3__', ko: '그룹에서 0~3개를 랜덤 출력해.', en: 'Output zero to three random tags from the group.' },
  { syntax: '__tag:Group|1k+__', ko: '사용횟수 1000 이상 태그만 사용해.', en: 'Use only tags with at least 1000 uses.' },
  { syntax: '__tag:Group|100-__', ko: '사용횟수 100 이하 태그만 사용해.', en: 'Use only tags with at most 100 uses.' },
  { syntax: '__my:Group|1-2__', ko: '내 프롬프트 그룹에서 1~2개를 랜덤 출력해. 네거티브 칸에서는 네거티브 그룹을 써.', en: 'Output one or two random prompts from your prompt group (the negative group in negative prompts).' },
  { syntax: 'preprocess', ko: '전처리 체인 키워드를 그대로 입력해.', en: 'Insert a preprocess chain keyword as plain text.' },
]

function movePriority(settings: PromptInlineSyntaxSettings, source: PromptInlineSyntaxSource, direction: -1 | 1) {
  const index = settings.priority.indexOf(source)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= settings.priority.length) {
    return settings
  }

  const priority = [...settings.priority]
  const [item] = priority.splice(index, 1)
  priority.splice(nextIndex, 0, item)
  return { ...settings, priority }
}

export function WildcardSyntaxSettingsPanel() {
  const { t } = useI18n()
  const { settings, setSettings } = usePromptInlineSyntaxSettings()

  const setTrigger = (source: PromptInlineTrigger, enabled: boolean) => {
    setSettings({
      ...settings,
      triggers: {
        ...settings.triggers,
        [source]: enabled,
      },
    })
  }

  return (
    <div className="max-w-5xl space-y-10 pt-2">
      <div className="grid gap-10 lg:grid-cols-2">
        <RowGroup
          headingAs="h2"
          heading={t({ ko: '단어 추천 우선순위', en: 'Word Suggestion Priority' })}
          actions={(
            <IconButton variant="ghost" size="icon-sm" onClick={() => setSettings(DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS)} label={t({ ko: '기본값', en: 'Reset' })}>
              <RotateCcw />
            </IconButton>
          )}
        >
          {settings.priority.map((source, index) => {
            const label = PROMPT_INLINE_SYNTAX_SOURCE_LABELS[source]
            return (
              <ListRow
                key={source}
                size="lg"
                leading={<span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>}
                trailing={(
                  <>
                    <IconButton variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => setSettings(movePriority(settings, source, -1))} label={t({ ko: '위로', en: 'Move up' })}>
                      <ArrowUp />
                    </IconButton>
                    <IconButton variant="ghost" size="icon-sm" disabled={index === settings.priority.length - 1} onClick={() => setSettings(movePriority(settings, source, 1))} label={t({ ko: '아래로', en: 'Move down' })}>
                      <ArrowDown />
                    </IconButton>
                  </>
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t({ ko: label.ko, en: label.en })}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{label.syntax}</span>
                </span>
              </ListRow>
            )
          })}
        </RowGroup>

        <RowGroup headingAs="h2" heading={t({ ko: '팝업 동작', en: 'Popup Behavior' })}>
          {PROMPT_INLINE_TRIGGERS.map((source) => {
            const label = PROMPT_INLINE_SYNTAX_SOURCE_LABELS[source]
            return (
              <SettingRow
                key={source}
                htmlFor={`wildcard-syntax-trigger-${source}`}
                label={t({ ko: label.ko, en: label.en })}
                description={<span className="font-mono">{label.syntax}</span>}
              >
                <Switch
                  id={`wildcard-syntax-trigger-${source}`}
                  checked={settings.triggers[source]}
                  onCheckedChange={(checked) => setTrigger(source, checked)}
                />
              </SettingRow>
            )
          })}
          <SettingRow
            htmlFor="wildcard-syntax-character-related"
            label={<span className="inline-flex items-center gap-1">{t({ ko: '캐릭터 관련 태그', en: 'Character Related Tags' })}<FieldInfo>{t({ ko: '감지된 캐릭터 칩에서 관련 태그 팝업 열기', en: 'Open related tags from detected character chips' })}</FieldInfo></span>}
          >
            <Switch
              id="wildcard-syntax-character-related"
              checked={settings.characterRelatedTags}
              onCheckedChange={(checked) => setSettings({ ...settings, characterRelatedTags: checked })}
            />
          </SettingRow>
          <SettingRow
            htmlFor="wildcard-syntax-tag-underscores"
            label={<span className="inline-flex items-center gap-1">{t({ ko: '태그를 밑줄로 넣기', en: 'Insert tags with underscores' })}<FieldInfo>{t({ ko: '끄면 blue hair, 켜면 blue_hair로 넣어.', en: 'Off inserts blue hair, on inserts blue_hair.' })}</FieldInfo></span>}
          >
            <Switch
              id="wildcard-syntax-tag-underscores"
              checked={settings.tagUnderscores}
              onCheckedChange={(checked) => setSettings({ ...settings, tagUnderscores: checked })}
            />
          </SettingRow>
        </RowGroup>
      </div>

      <RowGroup
        headingAs="h2"
        heading={t({ ko: '문법 안내', en: 'Syntax Guide' })}
        actions={<FieldInfo>{t({ ko: '완결된 토큰은 입력창에서 칩으로 보이고, 클릭하면 개수·사용량을 고를 수 있어. 예전 ++이름++, [1~2], <1k> 문법도 계속 동작해.', en: 'Finished tokens show as chips; click one to set pick count and usage. Old ++name++, [1~2] and <1k> forms still work.' })}</FieldInfo>}
      >
        {HELP_ITEMS.map((item) => (
          <ListRow key={item.syntax}>
            <span className="w-44 shrink-0 font-mono text-xs">{item.syntax}</span>
            <span className="min-w-0 text-xs text-muted-foreground">{t({ ko: item.ko, en: item.en })}</span>
          </ListRow>
        ))}
      </RowGroup>
    </div>
  )
}
