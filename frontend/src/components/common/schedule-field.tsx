import { useEffect, useId, useState, type ReactNode } from 'react'
import { Clock, Minus, Plus } from 'lucide-react'
import { FieldTabs, FramedField } from '@/components/common/field-tabs'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n, type TranslationInput } from '@/i18n'
import { cn } from '@/lib/utils'

export type ScheduleKind = 'once' | 'interval' | 'daily'

/** One schedule as the editor holds it. `runAt` is a `datetime-local` value; `maxRuns` null runs without end. */
export type ScheduleValue = {
  type: ScheduleKind
  runAt: string
  intervalMinutes: number
  dailyTime: string
  maxRuns: number | null
}

/** A `datetime-local` value for `value` (an hour from now when there is none). */
export function toDateTimeLocal(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date(Date.now() + 3600_000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type FormatDate = (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
type Translate = (input: TranslationInput, values?: Record<string, string | number>) => string

/** A due time in a list row: the clock for today and tomorrow, the day otherwise. */
export function shortRunLabel(value: string | Date, t: Translate, formatDate: FormatDate, now = new Date()) {
  const at = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  const time = formatDate(at, { hour: 'numeric', minute: '2-digit' })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (at.toDateString() === now.toDateString()) return time
  if (at.toDateString() === tomorrow.toDateString()) return t({ ko: '내일 {time}', en: 'Tomorrow {time}' }, { time })
  return formatDate(at, { ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** When the schedule would first run if saved now, read in this browser's clock (the server reads daily times in the row's zone). */
function firstRunAt(value: ScheduleValue, now: Date) {
  if (value.type === 'once') {
    const at = value.runAt ? new Date(value.runAt) : null
    return at && !Number.isNaN(at.getTime()) ? at : null
  }
  if (value.type === 'interval') return value.intervalMinutes > 0 ? new Date(now.getTime() + value.intervalMinutes * 60_000) : null
  const match = /^(\d{2}):(\d{2})$/.exec(value.dailyTime)
  if (!match) return null
  const at = new Date(now)
  at.setHours(Number(match[1]), Number(match[2]), 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/**
 * A whole-number stepper without a surface of its own (it sits in a field frame). With `unlimited`, stepping below
 * `min` (or clearing it, or typing 0) means no limit and shows ∞.
 */
function FrameStepper({ value, min, max, unlimited = false, disabled, label, onChange }: {
  value: number | null
  min: number
  max?: number
  unlimited?: boolean
  disabled?: boolean
  label: string
  onChange: (value: number | null) => void
}) {
  const { t } = useI18n()
  const shown = value === null ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next))
  const commit = (text: string) => {
    const trimmed = text.trim()
    const parsed = Number(trimmed)
    if (unlimited && (trimmed === '' || trimmed === '∞' || (Number.isFinite(parsed) && parsed < min))) return onChange(null)
    if (!trimmed || !Number.isFinite(parsed)) return setDraft(shown)
    const next = clamp(Math.round(parsed))
    setDraft(String(next))
    onChange(next)
  }
  const step = (direction: -1 | 1) => {
    if (value === null) return onChange(direction > 0 ? min : null)
    if (unlimited && direction < 0 && value <= min) return onChange(null)
    onChange(clamp(value + direction))
  }
  return (
    <div className="flex h-9 items-stretch">
      <IconButton type="button" variant="ghost" size="icon-sm" className="h-auto" disabled={disabled || (!unlimited && value !== null && value <= min) || (unlimited && value === null)} onClick={() => step(-1)} label={t({ ko: '줄이기', en: 'Decrease' })} tooltip={false}><Minus /></IconButton>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        placeholder={unlimited ? '∞' : undefined}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(event.currentTarget.value)
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            step(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        className={cn('min-w-0 flex-1 bg-transparent text-center text-sm tabular-nums text-foreground outline-none disabled:opacity-50', unlimited && 'placeholder:text-base placeholder:text-foreground')}
      />
      <IconButton type="button" variant="ghost" size="icon-sm" className="h-auto" disabled={disabled || (max !== undefined && value !== null && value >= max)} onClick={() => step(1)} label={t({ ko: '늘리기', en: 'Increase' })} tooltip={false}><Plus /></IconButton>
    </div>
  )
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={cn('min-w-0 px-3 pt-2 pb-1', className)}>
      <div id={id} className="text-2xs font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

/**
 * The schedule of a chat routine or a workflow autorun: once / every N minutes / daily as tabs in the field's frame,
 * the inputs that kind needs under them, and when it would first run.
 */
export function ScheduleField({ value, onChange, minIntervalMinutes = 1, disabled }: {
  value: ScheduleValue
  onChange: (patch: Partial<ScheduleValue>) => void
  minIntervalMinutes?: number
  disabled?: boolean
}) {
  const { t, formatDate } = useI18n()
  // The preview moves with the clock (an interval counts from "now").
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const next = firstRunAt(value, now)
  const past = value.type === 'once' && next !== null && next.getTime() <= now.getTime()
  const sameYear = next !== null && next.getFullYear() === now.getFullYear()
  const timeInputClass = 'h-9 w-full min-w-0 bg-transparent text-sm tabular-nums text-foreground outline-none disabled:opacity-50'
  const maxRuns = (
    <Cell label={t({ ko: '최대 횟수', en: 'Max runs' })} className="border-l border-line">
      <FrameStepper value={value.maxRuns} min={1} unlimited disabled={disabled} label={t({ ko: '최대 횟수', en: 'Max runs' })} onChange={(maxRuns) => onChange({ maxRuns })} />
    </Cell>
  )

  return (
    <FramedField label={t({ ko: '일정', en: 'Schedule' })}>
      <FieldTabs
        value={value.type}
        onChange={(type) => onChange({ type })}
        disabled={disabled}
        ariaLabel={t({ ko: '일정 방식', en: 'Schedule type' })}
        items={[
          { value: 'once', label: t({ ko: '1회', en: 'Once' }) },
          { value: 'interval', label: t({ ko: '반복', en: 'Repeat' }) },
          { value: 'daily', label: t({ ko: '매일', en: 'Daily' }) },
        ]}
      />
      {value.type === 'once' ? (
        <Cell label={t({ ko: '날짜와 시각', en: 'Date and time' })}>
          <input type="datetime-local" className={timeInputClass} value={value.runAt} disabled={disabled} aria-label={t({ ko: '실행 시각', en: 'Run at' })} onChange={(event) => onChange({ runAt: event.target.value })} />
        </Cell>
      ) : (
        <div className="grid grid-cols-2">
          {value.type === 'interval' ? (
            <Cell label={t({ ko: '간격(분)', en: 'Every (min)' })}>
              <FrameStepper value={value.intervalMinutes} min={minIntervalMinutes} disabled={disabled} label={t({ ko: '반복 간격(분)', en: 'Interval (min)' })} onChange={(intervalMinutes) => onChange({ intervalMinutes: intervalMinutes ?? minIntervalMinutes })} />
            </Cell>
          ) : (
            <Cell label={t({ ko: '시각', en: 'Time' })}>
              <input type="time" className={timeInputClass} value={value.dailyTime} disabled={disabled} aria-label={t({ ko: '실행 시각', en: 'Run at' })} onChange={(event) => onChange({ dailyTime: event.target.value })} />
            </Cell>
          )}
          {maxRuns}
        </div>
      )}
      {next ? (
        <div className={cn('flex items-center gap-1.5 border-t border-line px-3 py-2 text-xs tabular-nums', past ? 'text-destructive' : 'text-muted-foreground')}>
          <Clock className="size-3 shrink-0" aria-hidden="true" />
          {past ? t({ ko: '이미 지난 시각', en: 'Already past' }) : t({ ko: '다음', en: 'Next' })}
          <span className={cn('font-semibold', !past && 'text-foreground')}>
            {formatDate(next, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      ) : null}
    </FramedField>
  )
}
