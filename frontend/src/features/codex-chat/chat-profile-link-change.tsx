import { useQuery } from '@tanstack/react-query'
import type { ChatProfileCharacterLinkInput } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import { characterSettingQueryKey, getCharacterSetting } from '@/lib/api-character-library'

/** A proposal's link value as the card reads it (a stored link also carries its name and path). */
type LinkValue = (NonNullable<ChatProfileCharacterLinkInput> & { settingName?: string; path?: string[] }) | null

function readLink(value: unknown): LinkValue {
  if (!value || typeof value !== 'object') return null
  const link = value as Record<string, unknown>
  const settingId = Number(link.settingId)
  if (!(settingId > 0)) return null
  return { settingId, synced: link.synced !== false, settingName: typeof link.settingName === 'string' ? link.settingName : undefined, path: Array.isArray(link.path) ? link.path.map(String) : undefined }
}

/** One side of the change: the setting's path and name, synced or detached, and how many profiles a sync reaches. */
function LinkSide({ value, profileId }: { value: LinkValue; profileId: number | null }) {
  const { t } = useI18n()
  const canView = useFeaturePermissions().has('characters.view')
  const settingQuery = useQuery({
    queryKey: characterSettingQueryKey(value?.settingId ?? 0),
    queryFn: ({ signal }) => getCharacterSetting(value!.settingId, signal),
    enabled: canView && value !== null,
    retry: false,
  })
  if (!value) return <>{t({ ko: '연결 없음 (프로필 자체 외형)', en: 'No link (the profile’s own look)' })}</>
  const setting = settingQuery.data
  const name = setting ? [...setting.path, setting.name].join(' / ') : value.settingName ? [...(value.path ?? []), value.settingName].join(' / ') : `#${value.settingId}`
  // The proposed profile counts once its link is synced, even before it is saved.
  const reached = setting ? setting.linkedProfileCount + (value.synced && !setting.linkedProfiles.some((entry) => entry.id === profileId) ? 1 : 0) : null
  return <>
    {value.synced
      ? t({ ko: '‘{name}’ 설정과 동기화', en: 'Synced with ‘{name}’' }, { name })
      : t({ ko: '동기화 끊김 · 원본 ‘{name}’', en: 'Not synced · origin ‘{name}’' }, { name })}
    {value.synced && reached !== null ? <span className="text-muted-foreground"> · {t({ ko: '프로필 {count}개에 반영', en: 'reaches {count} profiles' }, { count: reached })}</span> : null}
    {settingQuery.isError ? <span className="text-destructive"> · {t({ ko: '설정을 찾지 못했어', en: 'setting not found' })}</span> : null}
  </>
}

/**
 * A profile proposal's character library link change (`characterLink`): the setting, synced or detached, and how many
 * synced profiles share its look. `before` is left out for a new profile.
 */
export function ChatProfileLinkChange({ after, before, profileId, showBefore }: { after: unknown; before?: unknown; profileId: number | null; showBefore: boolean }) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 text-xs">
      <span className="pt-px text-muted-foreground">{t({ ko: '캐릭터 연결', en: 'Character link' })}</span>
      <div className="min-w-0 space-y-0.5 break-words">
        {showBefore ? <div className="text-muted-foreground line-through"><LinkSide value={readLink(before)} profileId={profileId} /></div> : null}
        <div><LinkSide value={readLink(after)} profileId={profileId} /></div>
      </div>
    </div>
  )
}
