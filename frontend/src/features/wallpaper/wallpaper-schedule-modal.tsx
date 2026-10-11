import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import type { WallpaperSchedule, WallpaperScheduleEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { updateAppearanceSettings } from '@/lib/api-settings-appearance'
import type { WallpaperLayoutPreset } from './wallpaper-types'

const MAX_ENTRIES = 48
/** Monday first, the way a week reads on a calendar; values are Date#getDay numbers. */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

function newEntryId() {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface WallpaperScheduleModalProps {
  onClose: () => void
  presets: WallpaperLayoutPreset[]
  schedule: WallpaperSchedule | undefined
}

/** Switch the live wallpaper by time of day and weekday when no key or link pins a preset. */
export function WallpaperScheduleModal({ onClose, presets, schedule }: WallpaperScheduleModalProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const initial = schedule ?? { enabled: false, entries: [] }
  const [enabled, setEnabled] = useState(initial.enabled)
  const [entries, setEntries] = useState<WallpaperScheduleEntry[]>(initial.entries)
  const dirty = enabled !== initial.enabled || JSON.stringify(entries) !== JSON.stringify(initial.entries)
  const dayLabels = [
    t({ ko: '일', en: 'Su' }), t({ ko: '월', en: 'Mo' }), t({ ko: '화', en: 'Tu' }), t({ ko: '수', en: 'We' }),
    t({ ko: '목', en: 'Th' }), t({ ko: '금', en: 'Fr' }), t({ ko: '토', en: 'Sa' }),
  ]

  const saveMutation = useMutation({
    mutationFn: () => updateAppearanceSettings({ wallpaperSchedule: { enabled, entries: entries.filter((entry) => entry.presetId) } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallpaper-runtime-settings'] })
      showSnackbar({ message: t({ ko: '일정을 저장했어.', en: 'Saved the schedule.' }), tone: 'info' })
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '일정을 저장하지 못했어.', en: 'Could not save the schedule.' }), tone: 'error' }),
  })

  const patchEntry = (id: string, patch: Partial<WallpaperScheduleEntry>) => setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  const addEntry = () => setEntries((current) => [...current, { id: newEntryId(), presetId: presets[0]?.id ?? '', days: [], start: '09:00', end: '18:00' }])

  return (
    <Modal
      open
      onClose={onClose}
      size="normal"
      height="medium"
      dirty={dirty}
      onSave={saveMutation.isPending ? undefined : () => saveMutation.mutate()}
      title={t({ ko: '월페이퍼 일정', en: 'Wallpaper schedule' })}
      headerActions={<Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t({ ko: '일정 사용', en: 'Use the schedule' })} />}
    >
      <div className={enabled ? undefined : 'opacity-60'}>
        {entries.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t({ ko: '시간대를 추가해줘.', en: 'Add a time window.' })}</div>
        ) : entries.map((entry) => {
          const everyDay = entry.days.length === 0
          return (
            <div key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3">
              <Select className="w-44" aria-label={t({ ko: '월페이퍼', en: 'Wallpaper' })} value={entry.presetId} onChange={(event) => patchEntry(entry.id, { presetId: event.target.value })}>
                {presets.some((preset) => preset.id === entry.presetId) ? null : <option value={entry.presetId}>{t({ ko: '(삭제됨)', en: '(deleted)' })}</option>}
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </Select>
              <div className="flex items-center gap-1.5">
                <Input type="time" className="w-36" aria-label={t({ ko: '시작', en: 'Start' })} value={entry.start} onChange={(event) => event.target.value && patchEntry(entry.id, { start: event.target.value })} />
                <span className="text-muted-foreground">–</span>
                <Input type="time" className="w-36" aria-label={t({ ko: '끝', en: 'End' })} value={entry.end} onChange={(event) => event.target.value && patchEntry(entry.id, { end: event.target.value })} />
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-1">
                {WEEK.map((day) => (
                  <ToggleChip
                    key={day}
                    size="sm"
                    pressed={everyDay || entry.days.includes(day)}
                    onClick={() => {
                      const current = everyDay ? WEEK : entry.days
                      const next = current.includes(day) ? current.filter((value) => value !== day) : [...current, day]
                      // All seven (or none) means every day.
                      patchEntry(entry.id, { days: next.length === 7 || next.length === 0 ? [] : [...next].sort((a, b) => a - b) })
                    }}
                  >
                    {dayLabels[day]}
                  </ToggleChip>
                ))}
              </div>
              <IconButton variant="ghost" size="icon-sm" label={t({ ko: '시간대 삭제', en: 'Remove the window' })} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}>
                <Trash2 />
              </IconButton>
            </div>
          )
        })}
        <div className="pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title={t({ ko: '겹치면 위쪽이 이겨. 키나 링크로 고정한 월페이퍼는 그대로야.', en: 'The upper window wins on overlap. Wallpapers pinned by a key or link stay put.' })}
            disabled={presets.length === 0 || entries.length >= MAX_ENTRIES}
            onClick={addEntry}
          >
            <Plus className="size-4" />
            {t({ ko: '시간대 추가', en: 'Add a window' })}
          </Button>
        </div>
      </div>
      <ModalFooter className="mt-4 border-t border-line pt-3">
        <Button type="button" variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button type="button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>{t({ ko: '저장', en: 'Save' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
