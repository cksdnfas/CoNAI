import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  DEFAULT_FILE_NAMING_SETTINGS,
  FILE_NAME_TOKEN_CHIPS,
  FILE_NAMING_LIMITS,
  FILE_NAMING_PRESETS,
  describeFileNamePatternIssue,
  previewFileNamePattern,
  validateFileNamePattern,
  type FileNamePatternRole,
  type FileNamingSettings,
} from '@conai/shared'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { useServerTimeZoneQuery } from '../use-server-time-zone'
import { ChatFilledLabel } from './settings-filled-label'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsRowsSkeleton } from './settings-rows'

const ROLES: readonly FileNamePatternRole[] = ['upload', 'generated', 'collision']

const ROLE_LABELS: Record<FileNamePatternRole, { ko: string; en: string }> = {
  upload: { ko: '업로드', en: 'Uploads' },
  generated: { ko: '생성물', en: 'Generated files' },
  collision: { ko: '이름이 겹칠 때', en: 'When a name is taken' },
}

const ROLE_INFO: Record<FileNamePatternRole, { ko: string; en: string }> = {
  upload: { ko: '{name}은 올린 파일의 원래 이름이야.', en: '{name} is the uploaded file\'s own name.' },
  generated: { ko: '생성 화면에서 파일 이름을 적으면 이 패턴 대신 그 이름을 써.', en: 'A file name typed on the generation screen is used instead of this pattern.' },
  collision: { ko: '같은 폴더에 같은 이름이 있으면 이 패턴으로 바꿔. {n}이 없는데도 겹치면 _001을 붙여.', en: 'Used when the folder already has the name. Without {n}, _001 is added if it is still taken.' },
}

const TOKEN_INFO: Record<string, { ko: string; en: string }> = {
  '{name}': { ko: '원래 이름 (생성물에는 못 써)', en: 'Original name (not for generated files)' },
  '{yyyy}': { ko: '연도', en: 'Year' },
  '{MM}': { ko: '월', en: 'Month' },
  '{dd}': { ko: '일', en: 'Day' },
  '{HH}': { ko: '시', en: 'Hour' },
  '{mm}': { ko: '분', en: 'Minute' },
  '{ss}': { ko: '초', en: 'Second' },
  '{n:3}': { ko: '순번 001부터 (숫자는 자릿수)', en: 'Number from 001 (the digit is the width)' },
  '{rand}': { ko: '랜덤 6자', en: '6 random characters' },
  '{engine}': { ko: 'novelai · comfyui · codex (업로드는 upload)', en: 'novelai · comfyui · codex (upload for uploads)' },
}

interface FileNamingSettingsGroupProps {
  draft: FileNamingSettings | null
  onPatch: (patch: Partial<FileNamingSettings>) => void
  dirty: boolean
}

/** Settings › 미디어 처리 › 파일 이름: the stored-name patterns of uploads, results and taken names. */
export function FileNamingSettingsGroup({ draft, onPatch, dirty }: FileNamingSettingsGroupProps) {
  const { t } = useI18n()
  // Names carry the server's clock (settings › 시스템 › 시간대), not this browser's.
  const serverTimeZone = useServerTimeZoneQuery().data?.timeZone
  const inputs = useRef<Partial<Record<FileNamePatternRole, HTMLInputElement | null>>>({})
  // The pattern field the value chips write into: the one used last.
  const [target, setTarget] = useState<FileNamePatternRole>('upload')

  const insertToken = (token: string) => {
    if (!draft) return
    const role = target
    const input = inputs.current[role]
    const value = draft[role]
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? start
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`.slice(0, FILE_NAMING_LIMITS.patternLength)
    onPatch({ [role]: next })
    const caret = Math.min(start + token.length, next.length)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(caret, caret)
    })
  }

  return (
    <RowGroup
      data-settings-group="file-naming"
      className="scroll-mt-36"
      heading={t({ ko: '파일 이름', en: 'File names' })}
      actions={(
        <>
          <SectionDirtyBadge dirty={dirty} />
          <IconButton size="icon-sm" variant="ghost" disabled={!draft} onClick={() => onPatch({ ...DEFAULT_FILE_NAMING_SETTINGS })} label={t({ ko: '파일 이름 초기값으로 되돌리기', en: 'Restore file name defaults' })}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </>
      )}
    >
      {draft ? (
        <>
          {ROLES.map((role) => {
            const issue = validateFileNamePattern(draft[role], role)
            const label = t(ROLE_LABELS[role])
            return (
              <SettingRow
                key={role}
                label={<ChatFilledLabel fieldId={`fileNaming.${role}`}>{label}</ChatFilledLabel>}
                info={t(ROLE_INFO[role])}
                align="start"
                controlWidth="wide"
              >
                <div className="flex w-full min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {FILE_NAMING_PRESETS[role].map((preset) => (
                      <ToggleChip key={preset.id} size="sm" pressed={draft[role] === preset.pattern} onClick={() => onPatch({ [role]: preset.pattern })}>
                        {t(preset.label)}
                      </ToggleChip>
                    ))}
                  </div>
                  <Input
                    ref={(element) => { inputs.current[role] = element }}
                    variant="settings"
                    mono
                    value={draft[role]}
                    maxLength={FILE_NAMING_LIMITS.patternLength}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={label}
                    aria-invalid={issue ? true : undefined}
                    onFocus={() => setTarget(role)}
                    onChange={(event) => onPatch({ [role]: event.target.value })}
                  />
                  {issue ? (
                    <Text variant="caption" tone="destructive" role="alert">{t(describeFileNamePatternIssue(issue))}</Text>
                  ) : (
                    <Text variant="caption" mono className="truncate">{previewFileNamePattern(draft[role], role, { timeZone: serverTimeZone }).join(' · ')}</Text>
                  )}
                </div>
              </SettingRow>
            )
          })}
          <SettingRow
            label={t({ ko: '넣을 값', en: 'Values' })}
            info={t({ ko: '마지막으로 고른 패턴 칸의 커서 자리에 넣어.', en: 'Inserted at the cursor of the pattern field you used last.' })}
            align="start"
            controlWidth="wide"
          >
            <div className="flex w-full flex-wrap gap-1.5">
              {FILE_NAME_TOKEN_CHIPS.map((token) => (
                <Tip key={token} content={TOKEN_INFO[token] ? t(TOKEN_INFO[token]) : null}>
                  <ToggleChip
                    size="sm"
                    // {name} has no value in a generated name.
                    disabled={token === '{name}' && target === 'generated'}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertToken(token)}
                  >
                    <span className="font-mono">{token}</span>
                  </ToggleChip>
                </Tip>
              ))}
            </div>
          </SettingRow>
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}
