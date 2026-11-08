import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getActiveMiniMaxH3RefModRows,
  getFreeMiniMaxH3RefModSlot,
  MINIMAX_H3_REFMOD_MAX_SLOTS,
  type MiniMaxH3RefModLibraryEntry,
  type MiniMaxH3RefModRow,
} from '@conai/shared'
import { History, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Field, FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { comfyRefModLibraryQueryKey, getComfyRefModLibrary } from '@/lib/api-image-generation-workflows'
import { MiniMaxH3RefModRecordsDialog, RefModSourcesDisclosure } from './minimax-h3-refmod-sources'

const K = 'image-generation.components.minimax.h3.director.refmod.panel'

type MiniMaxH3DirectorRefModPanelProps = {
  rows: MiniMaxH3RefModRow[]
  /** Explicitly selected ComfyUI server; omitted for auto/tag routing, where the default server's library is shown. */
  serverId?: number
  /** The workflow only creates a RefMod (DaSiWa export node). */
  exportOnly?: boolean
  onChange: (rows: MiniMaxH3RefModRow[]) => void
}

/** REF2VA RefMod slots: saved MiniMax H3 reference bundles from the ComfyUI server's DaSiWa library. */
export function MiniMaxH3DirectorRefModPanel({ rows, serverId, exportOnly = false, onChange }: MiniMaxH3DirectorRefModPanelProps) {
  const { t } = useI18n()
  const [isRecordsOpen, setIsRecordsOpen] = useState(false)
  // Shared across Director instances and remounts; the library only changes when RefMods are exported, so it refreshes on demand.
  const library = useQuery({ queryKey: comfyRefModLibraryQueryKey(serverId), queryFn: () => getComfyRefModLibrary({ serverId }), staleTime: Infinity })
  const result = library.data
  const entries = result?.status === 'ok' ? result.entries : []
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]))
  const orderedRows = rows.map((row, index) => ({ row, index })).sort((left, right) => left.row.slot - right.row.slot)
  const freeSlot = getFreeMiniMaxH3RefModSlot(rows)
  const activeCount = getActiveMiniMaxH3RefModRows(rows).length
  const canAdd = result?.status === 'ok' && freeSlot !== null && rows.length < MINIMAX_H3_REFMOD_MAX_SLOTS

  const patchRow = (index: number, patch: Partial<MiniMaxH3RefModRow>) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const removeRow = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  const addRow = () => {
    if (!canAdd || freeSlot === null) return
    onChange([...rows, { slot: freeSlot, name: '', enabled: true, strength: 1, description: '' }])
  }
  // A record picked from the browser fills the first empty slot, or opens a new one.
  const emptyRow = orderedRows.find(({ row }) => !row.name)
  // Records are scoped to the server the library resolved; until it has, nothing can be listed or picked.
  const canPickRecord = result?.status === 'ok' && (Boolean(emptyRow) || (freeSlot !== null && rows.length < MINIMAX_H3_REFMOD_MAX_SLOTS))
  const pickRecord = (name: string) => {
    if (!canPickRecord) return
    if (emptyRow) patchRow(emptyRow.index, { name, enabled: true })
    else if (freeSlot !== null && rows.length < MINIMAX_H3_REFMOD_MAX_SLOTS) onChange([...rows, { slot: freeSlot, name, enabled: true, strength: 1, description: '' }])
    // A bundle saved after the library loaded is not listed yet.
    if (!entryByName.has(name)) void library.refetch()
  }
  const formatEntry = (entry: MiniMaxH3RefModLibraryEntry) => [
    entry.name,
    entry.kinds.join('+'),
    entry.concept,
    ...(entry.tokens !== null ? [t(`${K}.tokens`, { count: entry.tokens })] : []),
  ].join(' · ')

  return (
    <div className="ui-tone-plinth space-y-3 rounded-sm p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Text as="span" variant="label">{t(`${K}.title`)}</Text>
          <FieldInfo>{t(`${K}.help`)}</FieldInfo>
          {rows.length > 0 ? <Badge variant="secondary" size="sm">{t(`${K}.active.count`, { active: activeCount, total: rows.length })}</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton size="icon-sm" variant="ghost" disabled={result?.status !== 'ok'} onClick={() => setIsRecordsOpen(true)} label={t(`${K}.records.open`)}>
            <History className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="ghost" disabled={library.isFetching} aria-busy={library.isFetching} onClick={() => void library.refetch()} label={t(`${K}.refresh`)}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="secondary" disabled={!canAdd} onClick={addRow} label={t(`${K}.add`)}>
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {exportOnly ? <Text variant="caption" role="note">{t(`${K}.export.only`)}</Text> : null}
      {library.isPending ? <Text variant="caption" role="status">{t(`${K}.loading`)}</Text> : null}
      {result?.status === 'unavailable' ? (
        <Alert variant="warning">
          <AlertTitle>{t(`${K}.unavailable.title`)}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      ) : null}
      {result?.status === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>{t(`${K}.error.title`)}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      ) : null}

      {orderedRows.length > 0 ? (
        <div>
          {orderedRows.map(({ row, index }) => {
            const entry = entryByName.get(row.name)
            const slotLabel = t(`${K}.slot`, { slot: row.slot })
            return (
              <div key={`${row.slot}-${index}`} className="space-y-2 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Text as="span" variant="caption" mono className="shrink-0">{slotLabel}</Text>
                  <Select
                    className="min-w-0 flex-1"
                    aria-label={t(`${K}.select`, { slot: row.slot })}
                    value={row.name}
                    onChange={(event) => patchRow(index, { name: event.target.value })}
                  >
                    <option value="">{t(`${K}.select.placeholder`)}</option>
                    {row.name && !entry ? <option value={row.name}>{row.name}</option> : null}
                    {entries.map((candidate) => <option key={candidate.name} value={candidate.name}>{formatEntry(candidate)}</option>)}
                  </Select>
                  <Switch checked={row.enabled} aria-label={t(`${K}.enabled`, { slot: row.slot })} onCheckedChange={(enabled) => patchRow(index, { enabled })} />
                  <IconButton size="icon-sm" variant="ghost" onClick={() => removeRow(index)} label={t(`${K}.remove`, { slot: row.slot })}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>

                {entry ? (
                  <div>
                    <div className="flex flex-wrap items-center gap-1">
                      {entry.kinds.map((kind) => <Badge key={kind} variant="secondary" size="sm">{kind}</Badge>)}
                      <Badge variant="outline" size="sm">{entry.concept}</Badge>
                      {entry.tokens !== null ? <Text as="span" variant="caption">{t(`${K}.tokens`, { count: entry.tokens })}</Text> : null}
                    </div>
                    <RefModSourcesDisclosure key={entry.name} record={entry.conai} members={entry.members} />
                  </div>
                ) : row.name && result?.status === 'ok' ? (
                  <Badge variant="warning" size="sm">{t(`${K}.missing`)}</Badge>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Field label={t(`${K}.strength`)} className="sm:w-32 sm:shrink-0">
                    <NumberStepperInput
                      aria-label={t(`${K}.strength`)}
                      min={0}
                      max={1}
                      step={0.05}
                      value={String(row.strength)}
                      onValueCommit={(next) => patchRow(index, { strength: Number(next) })}
                    />
                  </Field>
                  <Field label={t(`${K}.description`)} className="min-w-0 flex-1">
                    <Textarea
                      rows={2}
                      value={row.description}
                      placeholder={entry?.description || t(`${K}.description.placeholder`)}
                      onChange={(event) => patchRow(index, { description: event.target.value })}
                    />
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {result?.status === 'ok' ? (
        <MiniMaxH3RefModRecordsDialog
          open={isRecordsOpen}
          serverId={result.serverId}
          canPick={canPickRecord}
          onPick={pickRecord}
          onClose={() => setIsRecordsOpen(false)}
        />
      ) : null}
    </div>
  )
}
