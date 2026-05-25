import { Handle, Position } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import type { ModulePortDataType } from '@/lib/api-module-graph'
import { buildHandleId, getPortTypeColor } from '../module-graph-shared'

export type KeyValueEntry = {
  key: string
  value: string
}

type ModuleGraphKeyValueListInputProps = {
  value: unknown
  onChange: (value: KeyValueEntry[]) => void
  compact?: boolean
  nodeId?: string
  connectionPrefix?: string
  connectionDataType?: ModulePortDataType
  connectedInputKeys?: Set<string>
  onDisconnectInput?: (nodeId: string, portKey: string) => void
}

/** Normalize stored key/value editor data into editable rows. */
export function normalizeKeyValueEntries(value: unknown): KeyValueEntry[] {
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

function buildKeyValueConnectionKey(connectionPrefix: string | undefined, key: string) {
  const trimmedKey = key.trim()
  return connectionPrefix && trimmedKey ? `${connectionPrefix}.${trimmedKey}` : null
}

export function getKeyValueConnectionKeys(value: unknown, connectionPrefix: string) {
  return normalizeKeyValueEntries(value)
    .map((entry) => buildKeyValueConnectionKey(connectionPrefix, entry.key))
    .filter((key): key is string => Boolean(key))
}

/** Render an expandable key/value list for API headers and request values. */
export function ModuleGraphKeyValueListInput({
  value,
  onChange,
  compact = false,
  nodeId,
  connectionPrefix,
  connectionDataType = 'any',
  connectedInputKeys,
  onDisconnectInput,
}: ModuleGraphKeyValueListInputProps) {
  const { t } = useI18n()
  const entries = normalizeKeyValueEntries(value)
  const visibleEntries = entries.length > 0 ? entries : [{ key: '', value: '' }]
  const inputClassName = compact ? 'h-7 text-[11px]' : undefined
  const rowClassName = compact
    ? 'grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-1'
    : 'grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]'
  const connectionColor = getPortTypeColor(connectionDataType)

  const updateEntry = (index: number, nextEntry: KeyValueEntry) => {
    onChange(visibleEntries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry)))
  }

  const removeEntry = (index: number) => {
    const nextEntries = visibleEntries.filter((_, entryIndex) => entryIndex !== index)
    onChange(nextEntries.length > 0 ? nextEntries : [])
  }

  return (
    <div className="space-y-2">
      {visibleEntries.map((entry, index) => {
        const connectionKey = buildKeyValueConnectionKey(connectionPrefix, entry.key)
        const connected = Boolean(connectionKey && connectedInputKeys?.has(connectionKey))

        return (
          <div key={index} className={`relative ${connectionKey ? 'pl-4' : ''}`}>
            {nodeId && connectionKey ? (
              <Handle
                id={buildHandleId('in', connectionKey)}
                type="target"
                position={Position.Left}
                style={{
                  top: '50%',
                  left: -7,
                  transform: 'translateY(-50%)',
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: connectionColor,
                  border: '2px solid var(--surface-container)',
                  boxShadow: `0 0 0 2px ${connectionColor}22`,
                }}
                title={t({ ko: '{key} 값 연결', en: 'Connect {key} value' }, { key: entry.key.trim() })}
                onMouseDown={connected ? () => onDisconnectInput?.(nodeId, connectionKey) : undefined}
              />
            ) : null}

            <div className={rowClassName}>
              <Input
                value={entry.key}
                onChange={(event) => updateEntry(index, { ...entry, key: event.target.value })}
                placeholder={t({ ko: '키', en: 'Key' })}
                className={inputClassName}
              />
              <Input
                value={connected ? t({ ko: '연결됨', en: 'Linked' }) : entry.value}
                onChange={(event) => updateEntry(index, { ...entry, value: event.target.value })}
                placeholder={t({ ko: '값', en: 'Value' })}
                className={inputClassName}
                disabled={connected}
              />
              <Button type="button" size={compact ? 'icon-sm' : 'sm'} variant="ghost" className={compact ? 'h-7 w-7' : undefined} onClick={() => removeEntry(index)}>
                {compact ? '×' : t({ ko: '삭제', en: 'Remove' })}
              </Button>
            </div>
          </div>
        )
      })}
      <Button type="button" size="sm" variant="outline" className={compact ? 'h-7 text-[11px]' : undefined} onClick={() => onChange([...visibleEntries, { key: '', value: '' }])}>
        {t({ ko: '항목 추가', en: 'Add item' })}
      </Button>
    </div>
  )
}
