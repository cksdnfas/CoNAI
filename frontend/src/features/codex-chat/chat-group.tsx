import { useEffect, useId, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, UserMinus, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_APPEARANCE_QUERY_KEY,
  addGroupChatMembers,
  createGroupChat,
  removeGroupChatMember,
  updateGroupChat,
  type ChatGroupInfo,
  type ChatProfileSummary,
  type ChatUserProfile,
  type CodexChatThreadDetail,
} from '@/lib/api-codex-chat'
import { CHAT_JUDGE_PRESET_NAMES_QUERY_KEY, listChatJudgePresetNames } from '@/lib/api-chat-judge'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatUserProfileSelect } from './chat-user-profiles'
import { EVERYONE_MENTION } from './chat-mentions'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'

const STACK_MAX = 3
export const GROUP_MEMBER_MAX = 6

/** The faces of a group room, overlapping (the first few members). */
export function GroupAvatarStack({ profiles, size = 'sm', ringClassName = 'ring-background' }: { profiles: ChatProfileSummary[]; size?: 'xs' | 'sm'; ringClassName?: string }) {
  return (
    <span className="flex shrink-0">
      {profiles.slice(0, STACK_MAX).map((profile, index) => (
        <ChatProfileAvatar key={profile.id} name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size={size} className={cn('ring-2', ringClassName, index > 0 && (size === 'xs' ? '-ml-2' : '-ml-1.5'))} />
      ))}
    </span>
  )
}

function LimitRow({ label, value, range, disabled, onCommit }: { label: string; value: number; range: { min: number; max: number }; disabled: boolean; onCommit: (value: number) => void }) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-2">
      <label htmlFor={id} className="text-sm">{label}</label>
      <NumberStepperInput id={id} className="w-28" value={value} min={range.min} max={range.max} disabled={disabled} onValueCommit={(next) => {
        const number = Number(next)
        if (Number.isSafeInteger(number) && number !== value) onCommit(number)
      }} />
    </div>
  )
}

/** The room's judge preset: it picks who answers a message that names no one and whether the room goes on. */
function JudgePresetRow({ value, open, disabled, onCommit }: { value: number | null; open: boolean; disabled: boolean; onCommit: (value: number | null) => void }) {
  const { t } = useI18n()
  const id = useId()
  const presetsQuery = useQuery({ queryKey: CHAT_JUDGE_PRESET_NAMES_QUERY_KEY, queryFn: listChatJudgePresetNames, enabled: open })
  const presets = presetsQuery.data ?? []
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-2">
      <label htmlFor={id} className="text-sm">{t({ ko: '판단 프리셋', en: 'Judge preset' })}</label>
      <Select id={id} className="h-8 w-36 text-xs" value={value ?? ''} disabled={disabled} onChange={(event) => onCommit(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{t({ ko: '없음', en: 'None' })}</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        {value !== null && presetsQuery.isSuccess && !presets.some((preset) => preset.id === value) ? <option value={value} disabled>{t({ ko: '프리셋 #{id}', en: 'Preset #{id}' }, { id: value })}</option> : null}
      </Select>
    </div>
  )
}

/** Members of a group room: who represents it, invite / remove, how far members may wake each other, and its judge. */
export function GroupMembersPopover({ threadId, group, profilesById, disabled, onInvite, children }: {
  threadId: number
  group: ChatGroupInfo
  profilesById: Map<number, ChatProfileSummary>
  disabled: boolean
  onInvite: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const members = group.memberIds.flatMap((id) => profilesById.get(id) ?? [])

  const applied = (detail: CodexChatThreadDetail) => {
    queryClient.setQueryData(codexChatThreadQueryKey(threadId), detail)
    void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '바꾸지 못했어.', en: 'Could not change it.' })), tone: 'error' })
  const updateMutation = useMutation({ mutationFn: (patch: Parameters<typeof updateGroupChat>[1]) => updateGroupChat(threadId, patch), onSuccess: applied, onError })
  const removeMutation = useMutation({ mutationFn: (profileId: number) => removeGroupChatMember(threadId, profileId), onSuccess: applied, onError })
  const busy = disabled || updateMutation.isPending || removeMutation.isPending

  const remove = async (profile: ChatProfileSummary) => {
    const confirmed = await confirm({
      title: t({ ko: '참가자 내보내기', en: 'Remove member' }),
      description: t({ ko: '{name}을(를) 이 방에서 내보낼까? 지금까지의 대화는 남아.', en: 'Remove {name} from this room? The conversation stays.' }, { name: profile.name }),
      confirmLabel: t({ ko: '내보내기', en: 'Remove' }),
      tone: 'destructive',
    })
    if (confirmed) removeMutation.mutate(profile.id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">{t({ ko: '참가자 {count}', en: 'Members {count}' }, { count: members.length })}</div>
        {members.map((profile) => {
          const representative = profile.id === group.representativeId
          return (
            <div key={profile.id} className="group/member flex min-h-12 items-center gap-2.5 rounded-sm pl-2 pr-1 hover:bg-fill">
              <ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{profile.name}</span>
                  {representative ? <Crown aria-label={t({ ko: '대표', en: 'Representative' })} className="size-3.5 shrink-0 text-secondary-text" /> : null}
                </div>
                {profile.tagline ? <div className="truncate text-xs text-muted-foreground">{profile.tagline}</div> : null}
              </div>
              {representative ? null : (
                <div className="flex">
                  <IconButton size="icon-xs" variant="ghost" disabled={busy} label={t({ ko: '대표로 지정', en: 'Make representative' })} onClick={() => updateMutation.mutate({ representativeId: profile.id })}><Crown /></IconButton>
                  <IconButton size="icon-xs" variant="ghost" disabled={busy || members.length <= 1} label={t({ ko: '방에서 내보내기', en: 'Remove from room' })} onClick={() => void remove(profile)}><UserMinus /></IconButton>
                </div>
              )}
            </div>
          )
        })}
        <div className="my-1 h-px bg-line" />
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-2 font-normal" disabled={busy || members.length >= GROUP_MEMBER_MAX} onClick={() => { setOpen(false); onInvite() }}>
          <UserPlus />{t({ ko: '참가자 초대', en: 'Invite members' })}
        </Button>
        <div className="my-1 h-px bg-line" />
        <LimitRow label={t({ ko: '봇끼리 이어지기', en: 'Bot-to-bot replies' })} value={group.chainLimit} range={group.limits.chain} disabled={busy} onCommit={(chainLimit) => updateMutation.mutate({ chainLimit })} />
        <LimitRow label={t({ ko: '넘길 대화', en: 'Messages handed over' })} value={group.windowLimit} range={group.limits.window} disabled={busy} onCommit={(windowLimit) => updateMutation.mutate({ windowLimit })} />
        <JudgePresetRow value={group.judgePresetId ?? null} open={open} disabled={busy} onCommit={(judgePresetId) => updateMutation.mutate({ judgePresetId })} />
      </PopoverContent>
    </Popover>
  )
}

export type GroupInviteMode = { kind: 'create'; baseProfileId: number } | { kind: 'add'; threadId: number; memberIds: number[] }

/**
 * Pick profiles for a group room. From a direct chat (`create`), that chat's profile stays checked as the
 * representative and a new room is made; in a room (`add`) the picked profiles join it.
 */
export function GroupInviteDialog({ open, mode, profiles, userProfiles = [], onClose, onCreated }: {
  open: boolean
  mode: GroupInviteMode | null
  profiles: ChatProfileSummary[]
  /** The account's user profiles; with two or more, a new room asks which one the user is (the default preselected). */
  userProfiles?: ChatUserProfile[]
  onClose: () => void
  onCreated: (threadId: number) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [userProfileId, setUserProfileId] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setPicked([])
      setTitle('')
      setTitleEdited(false)
      setUserProfileId(userProfiles.find((profile) => profile.isDefault)?.id ?? (userProfiles.length === 1 ? userProfiles[0].id : null))
    }
  }, [open, mode, userProfiles])

  const fixedIds = mode?.kind === 'create' ? [mode.baseProfileId] : mode?.memberIds ?? []
  const base = mode?.kind === 'create' ? profiles.find((profile) => profile.id === mode.baseProfileId) ?? null : null
  const candidates = profiles.filter((profile) => profile.usable && !fixedIds.includes(profile.id))
  const chosen = [...(base ? [base] : []), ...picked.flatMap((id) => profiles.find((profile) => profile.id === id) ?? [])]
  const defaultTitle = chosen.map((profile) => profile.name).join(', ')
  const roomSize = fixedIds.length + picked.length
  const takenNames = new Set([...fixedIds, ...picked].flatMap((id) => profiles.find((profile) => profile.id === id)?.name.trim().toLowerCase() ?? []))

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode?.kind === 'create') return (await createGroupChat({ profileIds: [mode.baseProfileId, ...picked], representativeId: mode.baseProfileId, title: (titleEdited ? title : defaultTitle).trim() || undefined, userProfileId })).id
      if (mode?.kind === 'add') {
        queryClient.setQueryData(codexChatThreadQueryKey(mode.threadId), await addGroupChatMembers(mode.threadId, picked))
        return mode.threadId
      }
      return null
    },
    onSuccess: async (threadId) => {
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      if (mode?.kind === 'create') void queryClient.invalidateQueries({ queryKey: CHAT_APPEARANCE_QUERY_KEY })
      onClose()
      if (threadId !== null && mode?.kind === 'create') onCreated(threadId)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '초대하지 못했어.', en: 'Could not invite.' })), tone: 'error' }),
  })

  const toggle = (id: number) => setPicked((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])

  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '참가자 초대', en: 'Invite members' })} widthClassName="max-w-md">
      <ModalBody className="space-y-4">
        <div className="max-h-[50vh] overflow-y-auto">
          {base ? (
            <div className="flex min-h-13 items-center gap-3 px-1">
              <ChatProfileAvatar name={base.name} avatar={base.avatar} profile={base} engine={base.engine} size="md" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold">
                <span className="truncate">{base.name}</span>
                <Crown aria-label={t({ ko: '대표', en: 'Representative' })} className="size-3.5 shrink-0 text-secondary-text" />
              </span>
              <Checkbox checked disabled aria-label={base.name} />
            </div>
          ) : null}
          {candidates.map((profile) => {
            const checked = picked.includes(profile.id)
            const blocked = !checked && (roomSize >= GROUP_MEMBER_MAX || takenNames.has(profile.name.trim().toLowerCase()))
            return (
              <label key={profile.id} className={cn('flex min-h-13 cursor-pointer items-center gap-3 border-t border-line px-1 first:border-t-0', blocked && 'cursor-not-allowed opacity-50')}>
                <ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="md" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{profile.name}</span>
                <Checkbox checked={checked} disabled={blocked} onCheckedChange={() => toggle(profile.id)} aria-label={profile.name} />
              </label>
            )
          })}
          {candidates.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t({ ko: '초대할 수 있는 프로필이 없어.', en: 'No profiles to invite.' })}</p> : null}
        </div>
        {mode?.kind === 'create' ? (
          <Field label={t({ ko: '방 이름', en: 'Room name' })}>
            <Input variant="settings" maxLength={60} value={titleEdited ? title : defaultTitle} onChange={(event) => { setTitle(event.target.value); setTitleEdited(true) }} />
          </Field>
        ) : null}
        {mode?.kind === 'create' && userProfiles.length >= 2 ? (
          <Field label={t({ ko: '사용자 프로필', en: 'User profile' })}>
            <ChatUserProfileSelect value={userProfileId} profiles={userProfiles} onChange={setUserProfileId} ariaLabel={t({ ko: '사용자 프로필', en: 'User profile' })} />
          </Field>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button onClick={() => mutation.mutate()} disabled={picked.length === 0 || mutation.isPending}>
          {mode?.kind === 'create' ? t({ ko: '그룹 만들기', en: 'Create group' }) : t({ ko: '초대', en: 'Invite' })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export type MentionOption = { key: string; name: string; profile: ChatProfileSummary | null; representative: boolean }

/** `@모두` first, then members whose name starts with what is typed. */
export function mentionOptions(query: string, members: ChatProfileSummary[], representativeId: number | null): MentionOption[] {
  const lower = query.toLowerCase()
  const options: MentionOption[] = [
    { key: 'everyone', name: EVERYONE_MENTION, profile: null, representative: false },
    ...members.map((profile) => ({ key: String(profile.id), name: profile.name, profile, representative: profile.id === representativeId })),
  ]
  return options.filter((option) => option.name.toLowerCase().startsWith(lower))
}

/** The `@` autocomplete above the composer (same popup as slash commands). */
export function MentionList({ id, options, selected, onSelect }: { id: string; options: MentionOption[]; selected: number; onSelect: (option: MentionOption) => void }) {
  const { t } = useI18n()
  return (
    <div id={id} role="listbox" aria-label={t({ ko: '멘션할 참가자', en: 'Members to mention' })} className="absolute bottom-full left-3 z-10 mb-1 max-h-72 w-64 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-md bg-surface-high p-1.5 shadow-elevation-2">
      {options.map((option, index) => (
        <Button key={option.key} id={`${id}-${index}`} role="option" aria-selected={selected === index} variant="ghost" size="sm" className={cn('w-full justify-start gap-2.5 font-semibold text-foreground', selected === index && 'bg-fill')} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(option)}>
          {option.profile
            ? <ChatProfileAvatar name={option.profile.name} avatar={option.profile.avatar} profile={option.profile} engine={option.profile.engine} size="sm" />
            : <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-highest"><Users className="size-3.5" /></span>}
          <span className="truncate">{option.name}</span>
          {option.representative ? <Crown aria-label={t({ ko: '대표', en: 'Representative' })} className="size-3 text-secondary-text" /> : null}
        </Button>
      ))}
    </div>
  )
}

/** Above the composer while a room answers: who is answering (several at once when their connection allows), and who comes next. */
export function GroupTurnStatus({ speakers, queue }: { speakers: ChatProfileSummary[]; queue: ChatProfileSummary[] }) {
  const { t } = useI18n()
  if (speakers.length === 0 && queue.length === 0) return null
  return (
    <div role="status" className="mb-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Spinner size="sm" />
      {speakers.length > 0 ? <><span className="truncate font-semibold text-foreground">{speakers.map((speaker) => speaker.name).join(', ')}</span><span className="shrink-0">{t({ ko: '답하는 중', en: 'replying' })}</span></> : null}
      {queue.length > 0 ? (
        <>
          {speakers.length > 0 ? <span aria-hidden="true" className="text-foreground/25">·</span> : null}
          <span className="shrink-0">{t({ ko: '다음', en: 'Next' })}</span>
          <span className="flex items-center gap-1">
            {queue.map((profile, index) => <ChatProfileAvatar key={`${profile.id}-${index}`} name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="xs" className="size-4" />)}
          </span>
        </>
      ) : null}
    </div>
  )
}
