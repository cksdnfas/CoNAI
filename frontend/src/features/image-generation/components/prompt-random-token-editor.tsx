import { useQuery } from '@tanstack/react-query'
import { Minus, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { parseWildcards } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import { PROMPT_RANDOM_SOURCE_TONE, usePromptRandomSourceLabels } from './prompt-random-palette'
import { serializePromptRandomToken, type PromptRandomPick, type PromptRandomToken, type PromptRandomTokenSpec, type PromptRandomUsage } from './prompt-random-token'
import type { PromptRandomTokenStatus } from './use-prompt-random-sources'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'

const PICK_PRESETS: Array<{ id: string; pick: PromptRandomPick; label: string }> = [
  { id: '1', pick: { min: 1, max: 1 }, label: '1' },
  { id: '1-2', pick: { min: 1, max: 2 }, label: '1~2' },
  { id: '2-3', pick: { min: 2, max: 3 }, label: '2~3' },
]

const USAGE_PRESETS: Array<{ id: string; usage: PromptRandomUsage; ko: string; en: string }> = [
  { id: 'all', usage: {}, ko: '전체', en: 'All' },
  { id: '1k', usage: { min: 1_000 }, ko: '1K 이상', en: '1K+' },
  { id: '10k', usage: { min: 10_000 }, ko: '10K 이상', en: '10K+' },
  { id: 'rare', usage: { max: 100 }, ko: '희귀만', en: 'Rare only' },
]

function isSamePick(left: PromptRandomPick, right: PromptRandomPick) {
  return left.min === right.min && left.max === right.max
}

function isSameUsage(left: PromptRandomUsage, right: PromptRandomUsage) {
  return left.min === right.min && left.max === right.max
}

function Segmented({ options, label }: { label: string; options: Array<{ id: string; label: string; selected: boolean; onSelect: () => void }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-sm bg-surface-container p-0.5">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          role="radio"
          size="xs"
          variant={option.selected ? 'secondary' : 'ghost'}
          aria-checked={option.selected}
          className="flex-1"
          onMouseDown={(event) => {
            event.preventDefault()
            option.onSelect()
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/** Chip editor: pick count and usage filter as buttons, live preview rolls, and the syntax it writes. */
export function PromptRandomTokenEditor({ token, status, tool, promptType, canPreview, onChange, onRemove, onRename }: {
  token: PromptRandomToken
  status: PromptRandomTokenStatus
  tool: PromptWildcardTool
  promptType: 'positive' | 'negative'
  canPreview: boolean
  onChange: (spec: PromptRandomTokenSpec) => void
  onRemove: () => void
  onRename: (name: string) => void
}) {
  const { t } = useI18n()
  const labels = usePromptRandomSourceLabels()
  const source = status.source
  const spec: PromptRandomTokenSpec = { source: token.source, name: token.name, pick: token.pick, usage: token.usage }
  const canonical = serializePromptRandomToken({ ...spec, source })
  const previewQuery = useQuery({
    queryKey: ['prompt-random-token-preview', tool, promptType, token.raw],
    queryFn: () => parseWildcards({ text: token.raw, tool, count: 3, promptType }),
    enabled: canPreview && status.state === 'ok',
    staleTime: 0,
  })
  const isCustomPick = !PICK_PRESETS.some((preset) => isSamePick(preset.pick, token.pick))
  const updatePick = (pick: PromptRandomPick) => onChange({ ...spec, source, pick })
  const stepper = (field: 'min' | 'max', delta: number) => {
    const nextValue = Math.max(0, Math.min(50, token.pick[field] + delta))
    const next = { ...token.pick, [field]: nextValue }
    updatePick(field === 'min' ? { min: next.min, max: Math.max(next.min, next.max) } : { min: Math.min(next.min, next.max), max: next.max })
  }

  return (
    <div className="w-full space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('shrink-0 rounded-sm px-1 text-2xs', PROMPT_RANDOM_SOURCE_TONE[source])}>{labels[source]}</span>
          <span className="truncate text-sm font-medium">{token.name}</span>
        </div>
      </div>

      {status.state === 'missing' ? (
        <div className="rounded-sm bg-destructive/10 px-2 py-1.5 text-destructive">
          {t({ ko: '이 이름을 찾을 수 없어 생성할 때 빈 값으로 들어가요.', en: 'This name was not found, so it becomes empty at generation.' })}
          {status.suggestion ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-1 underline"
              onMouseDown={(event) => {
                event.preventDefault()
                onRename(status.suggestion ?? token.name)
              }}
            >
              {t({ ko: `${status.suggestion}(으)로 바꾸기`, en: `Use ${status.suggestion}` })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-muted-foreground">{t({ ko: '뽑을 개수', en: 'Pick' })}</span>
          <Segmented
            label={t({ ko: '뽑을 개수', en: 'Pick' })}
            options={[
              ...PICK_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, selected: isSamePick(preset.pick, token.pick), onSelect: () => updatePick(preset.pick) })),
              { id: 'custom', label: t({ ko: '직접', en: 'Custom' }), selected: isCustomPick, onSelect: () => updatePick({ min: token.pick.min, max: token.pick.max + 1 }) },
            ]}
          />
          {isCustomPick ? (
            <>
              <span />
              <div className="flex items-center gap-3">
                {(['min', 'max'] as const).map((field) => (
                  <div key={field} className="flex items-center gap-1">
                    <span className="text-muted-foreground">{field === 'min' ? t({ ko: '최소', en: 'Min' }) : t({ ko: '최대', en: 'Max' })}</span>
                    <IconButton size="icon-xs" variant="ghost" label={t({ ko: '줄이기', en: 'Decrease' })} tooltip={false} onMouseDown={(event) => { event.preventDefault(); stepper(field, -1) }}><Minus /></IconButton>
                    <span className="w-5 text-center font-mono tabular-nums">{token.pick[field]}</span>
                    <IconButton size="icon-xs" variant="ghost" label={t({ ko: '늘리기', en: 'Increase' })} tooltip={false} onMouseDown={(event) => { event.preventDefault(); stepper(field, 1) }}><Plus /></IconButton>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {/* 사용량은 단부루/내 그룹에만 있다 (와일드카드 항목에는 사용횟수가 없음) */}
          {source !== 'wildcard' ? (
            <>
              <span className="text-muted-foreground">{t({ ko: '사용량', en: 'Usage' })}</span>
              <Segmented
                label={t({ ko: '사용량', en: 'Usage' })}
                options={USAGE_PRESETS.map((preset) => ({ id: preset.id, label: t({ ko: preset.ko, en: preset.en }), selected: isSameUsage(preset.usage, token.usage), onSelect: () => onChange({ ...spec, source, usage: preset.usage }) }))}
              />
            </>
          ) : null}
      </div>

      {canPreview && status.state === 'ok' ? (
        <div className="rounded-sm bg-surface-container p-2">
          <div className="mb-1 flex items-center justify-between text-2xs text-muted-foreground">
            <span>{t({ ko: '미리보기', en: 'Preview' })}</span>
            <IconButton size="icon-xs" variant="ghost" label={t({ ko: '다시 굴리기', en: 'Roll again' })} tooltip={false} onMouseDown={(event) => { event.preventDefault(); void previewQuery.refetch() }}>
              <RefreshCw />
            </IconButton>
          </div>
          {previewQuery.isLoading ? (
            <div className="text-muted-foreground">{t({ ko: '굴리는 중…', en: 'Rolling…' })}</div>
          ) : (
            <ol className="list-decimal space-y-0.5 pl-4">
              {(previewQuery.data?.results ?? []).map((result, index) => <li key={index} className="break-words">{result || t({ ko: '(빈 값)', en: '(empty)' })}</li>)}
            </ol>
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <code className="min-w-0 truncate text-2xs text-muted-foreground">{canonical}</code>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onMouseDown={(event) => {
            event.preventDefault()
            onRemove()
          }}
        >
          {t({ ko: '삭제', en: 'Remove' })}
        </Button>
      </div>
    </div>
  )
}
