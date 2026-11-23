import { LocateFixed } from 'lucide-react'
import { listTimeZoneNames, normalizeTimeZoneName, timeZoneOffsetLabel, zonedDateParts } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { RowPicker, type RowPickerItem } from '@/components/ui/row-picker'
import { SettingRow } from '@/components/ui/setting-row'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { useNow } from '@/lib/use-now'
import { useServerTimeZoneQuery } from '../use-server-time-zone'
import { ChatFilledLabel } from './settings-filled-label'

const pad = (value: number) => String(value).padStart(2, '0')

function zoneName(locale: string, timeZone: string, at: Date) {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

// ~400 zones × two Intl formatters take tens of ms (measured ~40–75 ms), so the rows are built once per language and hour.
let zoneItemsCache: { key: string; items: RowPickerItem[] } | null = null

/** Every zone as a picker row: its name, the zone's own name in the page language, and its UTC offset. */
function timeZoneItems(locale: string, hour: number): RowPickerItem[] {
  const key = `${locale}:${hour}`
  if (zoneItemsCache?.key === key) return zoneItemsCache.items
  const at = new Date(hour * 3_600_000)
  const items = listTimeZoneNames().map((timeZone) => {
    const offset = timeZoneOffsetLabel(timeZone, at)
    const localName = zoneName(locale, timeZone, at)
    return {
      id: timeZone,
      group: timeZone.includes('/') ? timeZone.slice(0, timeZone.indexOf('/')) : undefined,
      title: timeZone,
      subtitle: localName || undefined,
      trailing: offset,
      searchText: [timeZone, timeZone.replaceAll('_', ' '), localName, offset].join(' '),
    }
  })
  zoneItemsCache = { key, items }
  return items
}

/** Settings › 시스템 › 시간대: the zone the server's clock runs in ('' keeps the server's own), and that clock. */
export function TimeZoneSettingRow({ value, onChange }: { value: string; onChange: (timeZone: string) => void }) {
  const { t, locale } = useI18n()
  const serverQuery = useServerTimeZoneQuery()
  const server = serverQuery.data
  const now = useNow(15_000, Boolean(server))
  const label = t({ ko: '시간대', en: 'Time zone' })
  const browserTimeZone = normalizeTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const shownTimeZone = value || server?.serverTimeZone || ''
  // The server's clock: this browser's, moved by the difference seen when the server answered.
  const serverNow = server ? now + Date.parse(server.now) - serverQuery.dataUpdatedAt : now
  const clock = shownTimeZone ? zonedDateParts(new Date(serverNow), shownTimeZone) : null

  const serverItem: RowPickerItem = {
    id: '',
    title: server ? `${t({ ko: '서버 기본', en: 'Server default' })} (${server.serverTimeZone})` : t({ ko: '서버 기본', en: 'Server default' }),
    trailing: server ? timeZoneOffsetLabel(server.serverTimeZone) : undefined,
    searchText: `${t({ ko: '서버 기본', en: 'Server default' })} server ${server?.serverTimeZone ?? ''}`,
  }
  const zoneItems = timeZoneItems(locale, Math.floor(now / 3_600_000))
  // A saved zone this browser does not list (another ICU version) still shows and stays picked.
  const items = value && !zoneItems.some((item) => item.id === value)
    ? [serverItem, { id: value, title: value, searchText: value }, ...zoneItems]
    : [serverItem, ...zoneItems]

  return (
    <SettingRow
      label={<ChatFilledLabel fieldId="timeZone">{label}</ChatFilledLabel>}
      info={t({ ko: '파일 이름·날짜 폴더처럼 서버가 날짜와 시각을 쓸 때 이 시간대를 따라.', en: 'The server writes dates and times, such as file names and date folders, in this zone.' })}
      controlWidth="wide"
      controlClassName="flex-nowrap"
    >
      <div className="min-w-0 flex-1">
        <RowPicker
          variant="settings"
          items={items}
          value={value}
          onChange={onChange}
          ariaLabel={label}
          placeholder={label}
          searchPlaceholder={t({ ko: '시간대 찾기', en: 'Find a time zone' })}
          emptyLabel={t({ ko: '맞는 시간대가 없어', en: 'No matching time zone' })}
        />
      </div>
      {clock ? (
        <Tip content={t({ ko: '서버 시각', en: 'Server time' })}>
          <Text as="span" variant="caption" mono className="shrink-0">
            {`${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`}
          </Text>
        </Tip>
      ) : null}
      <IconButton
        size="icon-sm"
        variant="ghost"
        disabled={!browserTimeZone || shownTimeZone === browserTimeZone}
        label={t({ ko: '이 브라우저 시간대로 맞추기 ({zone})', en: 'Use this browser\'s time zone ({zone})' }, { zone: browserTimeZone || '—' })}
        onClick={() => onChange(browserTimeZone)}
      >
        <LocateFixed className="h-4 w-4" />
      </IconButton>
    </SettingRow>
  )
}
