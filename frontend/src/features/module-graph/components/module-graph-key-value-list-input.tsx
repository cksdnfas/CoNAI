import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

type KeyValueEntry = {
  key: string
  value: string
}

type ModuleGraphKeyValueListInputProps = {
  value: unknown
  onChange: (value: KeyValueEntry[]) => void
}

/** Normalize stored key/value editor data into editable rows. */
function normalizeKeyValueEntries(value: unknown): KeyValueEntry[] {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const typedEntry = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return {
        key: typeof typedEntry.key === 'string' ? typedEntry.key : '',
        value: typeof typedEntry.value === 'string'
          ? typedEntry.value
          : typedEntry.value === undefined || typedEntry.value === null
            ? ''
            : typeof typedEntry.value === 'object'
              ? JSON.stringify(typedEntry.value)
              : String(typedEntry.value),
      }
    })
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
      key,
      value: typeof entryValue === 'string'
        ? entryValue
        : entryValue === undefined || entryValue === null
          ? ''
          : typeof entryValue === 'object'
            ? JSON.stringify(entryValue)
            : String(entryValue),
    }))
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeKeyValueEntries(JSON.parse(value))
    } catch {
      return []
    }
  }

  return []
}

/** Render an expandable key/value list for API headers and request values. */
export function ModuleGraphKeyValueListInput({ value, onChange }: ModuleGraphKeyValueListInputProps) {
  const { t } = useI18n()
  const entries = normalizeKeyValueEntries(value)
  const visibleEntries = entries.length > 0 ? entries : [{ key: '', value: '' }]

  const updateEntry = (index: number, nextEntry: KeyValueEntry) => {
    onChange(visibleEntries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry)))
  }

  const removeEntry = (index: number) => {
    const nextEntries = visibleEntries.filter((_, entryIndex) => entryIndex !== index)
    onChange(nextEntries.length > 0 ? nextEntries : [])
  }

  return (
    <div className="space-y-2">
      {visibleEntries.map((entry, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
          <Input
            value={entry.key}
            onChange={(event) => updateEntry(index, { ...entry, key: event.target.value })}
            placeholder={t({ ko: '키', en: 'Key' })}
          />
          <Input
            value={entry.value}
            onChange={(event) => updateEntry(index, { ...entry, value: event.target.value })}
            placeholder={t({ ko: '값', en: 'Value' })}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => removeEntry(index)}>
            {t({ ko: '삭제', en: 'Remove' })}
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...visibleEntries, { key: '', value: '' }])}>
        {t({ ko: '항목 추가', en: 'Add item' })}
      </Button>
    </div>
  )
}
