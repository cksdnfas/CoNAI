import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { CharacterSettingPickerDialog } from '@/features/characters/components/character-setting-picker-dialog'
import { useI18n } from '@/i18n'
import { characterSettingQueryKey, getCharacterSetting } from '@/lib/api-character-library'
import { CHARACTER_SETTING_INPUT_KEY } from '../module-graph-exclusive-inputs'
import { stopNodeEvent } from './module-graph-node-controls'

/** Whether an input names a character library setting, so it gets the library picker instead of a number box. */
export function isCharacterSettingInput(key: string) {
  return key === CHARACTER_SETTING_INPUT_KEY
}

function toSettingId(value: unknown) {
  const id = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * A node's character library setting (`character_setting_id`): shows the chosen setting and opens the library picker.
 * The node takes it or a chat profile, not both (`setExclusiveNodeInputValue` clears the other).
 */
export function CharacterSettingIdInput({ value, onChange, onClear, compact = false }: {
  value: unknown
  onChange: (settingId: number) => void
  onClear: () => void
  /** The node-card size (24px row) with its own clear key; the panel clears from the port header. */
  compact?: boolean
}) {
  const { t } = useI18n()
  const canView = useFeaturePermissions().has('characters.view')
  const [open, setOpen] = useState(false)
  const settingId = toSettingId(value)
  const settingQuery = useQuery({
    queryKey: characterSettingQueryKey(settingId ?? 0),
    queryFn: ({ signal }) => getCharacterSetting(settingId as number, signal),
    enabled: canView && settingId !== null,
    staleTime: 60_000,
    retry: false,
  })
  const setting = settingQuery.data
  const label = settingId === null
    ? t({ ko: '외형 설정 고르기', en: 'Choose appearance setting' })
    : setting
      ? [...setting.path, setting.name].join(' / ')
      : settingQuery.isError
        ? t({ ko: '없는 외형 설정 (#{id})', en: 'Missing setting (#{id})' }, { id: settingId })
        : `#${settingId}`

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1" onMouseDown={stopNodeEvent} onPointerDown={stopNodeEvent}>
      <Button
        type="button"
        variant="field"
        size={compact ? 'xs' : 'field'}
        className="nodrag min-w-0 flex-1"
        title={label}
        disabled={!canView}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <UserRound />
      </Button>
      {compact && settingId !== null ? (
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="nodrag"
          label={t({ ko: '외형 설정 빼기', en: 'Clear appearance setting' })}
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
        >
          <X />
        </IconButton>
      ) : null}
      <CharacterSettingPickerDialog open={open} onOpenChange={setOpen} onPick={(picked) => onChange(picked.id)} initialFolderId={setting?.folderId ?? null} />
    </span>
  )
}
