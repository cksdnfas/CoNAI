import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS,
  PROMPT_INLINE_SYNTAX_SOURCE_LABELS,
  type PromptInlineSyntaxSettings,
  type PromptInlineSyntaxSource,
  usePromptInlineSyntaxSettings,
} from './prompt-inline-syntax-settings'

const HELP_ITEMS = [
  { syntax: '__Group__', ko: '그룹에서 랜덤 1개를 출력해.', en: 'Output one random tag from the group.' },
  { syntax: '__Group[3]__', ko: '그룹에서 정확히 3개를 출력해.', en: 'Output exactly three tags from the group.' },
  { syntax: '__Group[0~3]__', ko: '그룹에서 0~3개를 랜덤 출력해.', en: 'Output zero to three random tags from the group.' },
  { syntax: '__Group<1k>__', ko: '사용횟수 1000 이상 태그만 사용해.', en: 'Use only tags with at least 1000 uses.' },
  { syntax: '__Group<-100>__', ko: '사용횟수 100 이하 태그만 사용해.', en: 'Use only tags with at most 100 uses.' },
  { syntax: '__Group[3]<1k>__', ko: '개수와 사용횟수 필터를 같이 적용해.', en: 'Apply pick count and usage filters together.' },
  { syntax: '++Wildcard++', ko: '기존 와일드카드 항목을 출력해.', en: 'Output an existing wildcard entry.' },
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

  const setTrigger = (source: PromptInlineSyntaxSource, enabled: boolean) => {
    setSettings({
      ...settings,
      triggers: {
        ...settings.triggers,
        [source]: enabled,
      },
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-foreground">{t({ ko: '문법 우선순위', en: 'Syntax Priority' })}</div>
          <Button type="button" variant="outline" size="sm" onClick={() => setSettings(DEFAULT_PROMPT_INLINE_SYNTAX_SETTINGS)}>
            <RotateCcw className="h-4 w-4" />
            {t({ ko: '기본값', en: 'Reset' })}
          </Button>
        </div>

        <div className="space-y-2">
          {settings.priority.map((source, index) => {
            const label = PROMPT_INLINE_SYNTAX_SOURCE_LABELS[source]
            return (
              <div key={source} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-border bg-surface-container px-3 py-2">
                <Badge variant="secondary">{index + 1}</Badge>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{t({ ko: label.ko, en: label.en })}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{label.syntax}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => setSettings(movePriority(settings, source, -1))} aria-label={t({ ko: '위로', en: 'Move up' })}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={index === settings.priority.length - 1} onClick={() => setSettings(movePriority(settings, source, 1))} aria-label={t({ ko: '아래로', en: 'Move down' })}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
        <div className="text-sm font-semibold text-foreground">{t({ ko: '팝업 동작', en: 'Popup Behavior' })}</div>
        <div className="space-y-2">
          {settings.priority.map((source) => {
            const label = PROMPT_INLINE_SYNTAX_SOURCE_LABELS[source]
            return (
              <label key={source} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-container px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{t({ ko: label.ko, en: label.en })}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{label.syntax}</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.triggers[source]}
                  onChange={(event) => setTrigger(source, event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            )
          })}
          <label className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-container px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">{t({ ko: '캐릭터 관련 태그', en: 'Character Related Tags' })}</span>
              <span className="block truncate text-xs text-muted-foreground">{t({ ko: '감지된 캐릭터 칩에서 관련 태그 팝업 열기', en: 'Open related tags from detected character chips' })}</span>
            </span>
            <input
              type="checkbox"
              checked={settings.characterRelatedTags}
              onChange={(event) => setSettings({ ...settings, characterRelatedTags: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>
        <div className="rounded-sm border border-border bg-surface-container px-3 py-2 text-xs text-muted-foreground">
          {t({ ko: '완결된 __...__, ++...++, 쉼표 뒤 빈 구간에서는 추천 팝업을 띄우지 않아.', en: 'Suggestion popups stay hidden on completed __...__, ++...++, and empty comma-separated segments.' })}
        </div>
      </section>

      <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4 lg:col-span-2">
        <div className="text-sm font-semibold text-foreground">{t({ ko: '문법 안내', en: 'Syntax Guide' })}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {HELP_ITEMS.map((item) => (
            <div key={item.syntax} className={cn('rounded-sm border border-border bg-surface-container px-3 py-2')}>
              <div className="font-mono text-xs text-foreground">{item.syntax}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t({ ko: item.ko, en: item.en })}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
