import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { readAvatarFile } from '@/features/settings/components/chat-profile-images'
import { useI18n } from '@/i18n'
import {
  CHAT_MODEL_OPTIONS_QUERY_KEY,
  CHAT_USER_PROFILE_LIMITS,
  CHAT_USER_PROFILES_QUERY_KEY,
  createChatUserProfile,
  deleteChatUserProfile,
  listChatModelOptions,
  listChatUserProfiles,
  updateChatUserProfile,
  updateCodexChatThreadContext,
  type ChatUserProfile,
  type CodexChatThread,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'

/** The account's user profiles (everyone keeps their own). */
export function useChatUserProfiles(enabled = true) {
  return useQuery({ queryKey: CHAT_USER_PROFILES_QUERY_KEY, queryFn: listChatUserProfiles, enabled, staleTime: 60_000 })
}

/** Who the user is in a chat, for the account's own messages: the chat's profile, else nobody in particular. */
export function userSpeakerOf(thread: Pick<CodexChatThread, 'user_profile_id'> | null | undefined, profiles: ChatUserProfile[]) {
  const id = thread?.user_profile_id ?? null
  return id === null ? null : profiles.find((profile) => profile.id === id) ?? null
}

/**
 * What a new chat does about the user profile: with none, one, or a default it goes ahead (`auto`, the server picks
 * the same one); with several and no default the user picks first.
 */
export function newChatUserProfile(profiles: ChatUserProfile[]): { kind: 'auto' } | { kind: 'pick' } {
  return profiles.length <= 1 || profiles.some((profile) => profile.isDefault) ? { kind: 'auto' } : { kind: 'pick' }
}

export function ChatUserProfileAvatar({ profile, size = 'md', className }: { profile: Pick<ChatUserProfile, 'name' | 'avatar'>; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  return <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine="llm" size={size} className={className} />
}

/** Create or edit one user profile: avatar, name, the description the models get, and whether new chats take it. */
export function ChatUserProfileEditorModal({ open, profile, onClose }: { open: boolean; profile: ChatUserProfile | null; onClose: () => void }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<{ name: string; persona: string; avatar: string | null; isDefault: boolean; modelSlotId: number | null }>({ name: '', persona: '', avatar: null, isDefault: false, modelSlotId: null })
  const modelsQuery = useQuery({ queryKey: CHAT_MODEL_OPTIONS_QUERY_KEY, queryFn: listChatModelOptions, enabled: open })
  const models = modelsQuery.data ?? []

  useEffect(() => {
    if (open) setDraft({ name: profile?.name ?? '', persona: profile?.persona ?? '', avatar: profile?.avatar ?? null, isDefault: profile?.isDefault ?? false, modelSlotId: profile?.modelSlotId ?? null })
  }, [profile, open])

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_USER_PROFILES_QUERY_KEY }),
    // Chats show the profile's name and avatar on the user's messages.
    queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }),
  ])
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const saveMutation = useMutation({
    mutationFn: () => (profile ? updateChatUserProfile(profile.id, draft) : createChatUserProfile(draft)),
    onSuccess: async () => { await refresh(); onClose() },
    onError,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatUserProfile(profile?.id ?? 0),
    onSuccess: async () => { await refresh(); onClose() },
    onError,
  })
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '사용자 프로필 삭제', en: 'Delete user profile' }),
      description: t({ ko: '이 프로필을 지울까? 쓰고 있던 채팅은 기본 사용자로 돌아가.', en: 'Delete this profile? Chats using it go back to the plain user.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }
  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const avatar = await readAvatarFile(file)
      setDraft((current) => ({ ...current, avatar }))
    } catch {
      showSnackbar({ message: t({ ko: '이미지를 읽지 못했어.', en: 'Could not read the image.' }), tone: 'error' })
    }
  }
  const canSave = draft.name.trim().length > 0 && !saveMutation.isPending

  return (
    <Modal open={open} onClose={onClose} title={profile ? t({ ko: '사용자 프로필 편집', en: 'Edit user profile' }) : t({ ko: '사용자 프로필 추가', en: 'Add user profile' })} widthClassName="max-w-lg">
      <ModalBody className="space-y-4">
        <div className="flex items-end gap-3">
          {/* eslint-disable-next-line no-restricted-syntax -- the avatar itself is the control */}
          <button type="button" className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={() => fileInputRef.current?.click()} aria-label={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
            <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} engine="llm" size="xl" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void handleAvatarFile(event)} />
          <Field label={t({ ko: '이름', en: 'Name' })} className="min-w-0 flex-1">
            <Input variant="settings" value={draft.name} maxLength={CHAT_USER_PROFILE_LIMITS.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </Field>
        </div>
        <Field label={t({ ko: '설명', en: 'Description' })}>
          <Textarea
            variant="settings"
            rows={6}
            maxLength={CHAT_USER_PROFILE_LIMITS.persona}
            value={draft.persona}
            placeholder={t({ ko: '모델이 알아야 할 나에 대한 설명. 성격, 외모, 캐릭터와의 관계…', en: 'What the models should know about you: personality, looks, your relationship with the character…' })}
            onChange={(event) => setDraft((current) => ({ ...current, persona: event.target.value }))}
          />
        </Field>
        <Field label={t({ ko: '모델', en: 'Model' })} info={t({ ko: '채팅 프로필의 답장 추천을 이 프로필이 쓸 때 쓰는 모델.', en: 'The model used when this profile writes reply suggestions for a chat profile.' })}>
          <Select
            variant="settings"
            value={draft.modelSlotId === null ? '' : String(draft.modelSlotId)}
            disabled={!modelsQuery.isSuccess}
            onChange={(event) => setDraft((current) => ({ ...current, modelSlotId: event.target.value ? Number(event.target.value) : null }))}
          >
            <option value="">{t({ ko: '없음', en: 'None' })}</option>
            {/* A model whose connection cannot be used shows greyed out. */}
            {models.map((model) => <option key={model.id} value={model.id} disabled={!model.ready}>{model.label}</option>)}
          </Select>
        </Field>
      </ModalBody>
      <ModalFooter>
        {profile ? <IconButton size="icon-sm" variant="destructive" disabled={deleteMutation.isPending} onClick={() => void handleDelete()} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton> : null}
        {draft.avatar ? <Button size="sm" variant="ghost" onClick={() => setDraft((current) => ({ ...current, avatar: null }))}>{t({ ko: '아바타 지우기', en: 'Remove avatar' })}</Button> : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="ghost" active={draft.isDefault} onClick={() => setDraft((current) => ({ ...current, isDefault: !current.isDefault }))} label={t({ ko: '새 채팅 기본', en: 'Default for new chats' })}>
          <Star className={cn(draft.isDefault && 'fill-current')} />
        </IconButton>
        <IconButton size="icon-sm" variant="default" disabled={!canSave} onClick={() => saveMutation.mutate()} label={t({ ko: '저장', en: 'Save' })}><Save /></IconButton>
      </ModalFooter>
    </Modal>
  )
}

/** The account's user profiles as rows; the star marks (and sets) the default for new chats. */
export function ChatUserProfileRows({ profiles, onEdit }: { profiles: ChatUserProfile[]; onEdit: (profile: ChatUserProfile) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const defaultMutation = useMutation({
    mutationFn: (profile: ChatUserProfile) => updateChatUserProfile(profile.id, { name: profile.name, persona: profile.persona, avatar: profile.avatar, isDefault: !profile.isDefault }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_USER_PROFILES_QUERY_KEY }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  return (
    <>
      {profiles.map((profile) => (
        <ResourceRow
          key={profile.id}
          leading={<ChatUserProfileAvatar profile={profile} size="md" />}
          name={profile.name}
          trailing={(
            <IconButton size="icon-sm" variant="ghost" active={profile.isDefault} disabled={defaultMutation.isPending} onClick={() => defaultMutation.mutate(profile)} label={t({ ko: '새 채팅 기본', en: 'Default for new chats' })}>
              <Star className={cn(profile.isDefault && 'fill-current')} />
            </IconButton>
          )}
          onOpen={() => onEdit(profile)}
        />
      ))}
    </>
  )
}

/** From the chat: the account's user profiles, to add and edit without leaving the conversation. */
export function ChatUserProfileManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const profilesQuery = useChatUserProfiles(open)
  const [editor, setEditor] = useState<{ profile: ChatUserProfile | null } | null>(null)
  const profiles = profilesQuery.data ?? []
  const full = profiles.length >= CHAT_USER_PROFILE_LIMITS.perAccount

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t({ ko: '사용자 프로필', en: 'User profiles' })}
        widthClassName="max-w-xl"
        headerContent={<IconButton size="icon-sm" variant="ghost" disabled={full} onClick={() => setEditor({ profile: null })} label={t({ ko: '사용자 프로필 추가', en: 'Add user profile' })}><Plus /></IconButton>}
      >
        <ModalBody>
          {profilesQuery.isSuccess && profiles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground">
              {t({ ko: '아직 사용자 프로필이 없어.', en: 'No user profiles yet.' })}
              <IconButton size="icon-sm" variant="secondary" label={t({ ko: '사용자 프로필 추가', en: 'Add user profile' })} onClick={() => setEditor({ profile: null })}><Plus /></IconButton>
            </div>
          ) : (
            <ChatUserProfileRows profiles={profiles} onEdit={(profile) => setEditor({ profile })} />
          )}
        </ModalBody>
      </Modal>
      <ChatUserProfileEditorModal open={editor !== null} profile={editor?.profile ?? null} onClose={() => setEditor(null)} />
    </>
  )
}

/** Before a new chat when several user profiles exist and none is the default: who am I in this chat? */
export function ChatUserProfilePickModal({ open, profiles, onPick, onClose }: {
  open: boolean
  profiles: ChatUserProfile[]
  onPick: (userProfileId: number | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '누구로 참여할까?', en: 'Who are you in this chat?' })} widthClassName="max-w-sm">
      <ModalBody className="pb-2">
        {profiles.map((profile) => (
          <ListRow key={profile.id} asChild interactive>
            <button type="button" className="w-full gap-3 text-left" onClick={() => onPick(profile.id)}>
              <ChatUserProfileAvatar profile={profile} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{profile.name}</span>
              </span>
            </button>
          </ListRow>
        ))}
        <ListRow asChild interactive>
          <button type="button" className="w-full gap-3 text-left text-muted-foreground" onClick={() => onPick(null)}>
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-high text-xs font-bold">?</span>
            <span className="text-sm">{t({ ko: '프로필 없이', en: 'No profile' })}</span>
          </button>
        </ListRow>
      </ModalBody>
    </Modal>
  )
}

/** A native select of the account's user profiles plus "none"; `value` null is the plain user. */
export function ChatUserProfileSelect({ value, profiles, disabled, onChange, className, ariaLabel }: {
  value: number | null
  profiles: ChatUserProfile[]
  disabled?: boolean
  onChange: (userProfileId: number | null) => void
  className?: string
  ariaLabel?: string
}) {
  const { t } = useI18n()
  return (
    <Select variant="settings" className={className} value={value === null ? '' : String(value)} disabled={disabled} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
      <option value="">{t({ ko: '기본 사용자', en: 'Plain user' })}</option>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? ' ★' : ''}</option>)}
    </Select>
  )
}

/** In a chat's context view: which user profile the chat uses (changes apply from the next request). */
export function ChatUserProfileRow({ thread }: { thread: CodexChatThread }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const profilesQuery = useChatUserProfiles()
  const profiles = profilesQuery.data ?? []
  const current = userSpeakerOf(thread, profiles)
  const mutation = useMutation({
    mutationFn: (userProfileId: number | null) => updateCodexChatThreadContext(thread.id, { userProfileId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) })
      void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  return (
    <SettingRow
      label={(
        <span className="flex items-center gap-2">
          {current ? <ChatUserProfileAvatar profile={current} size="sm" /> : null}
          <span>{t({ ko: '사용자 프로필', en: 'User profile' })}</span>
        </span>
      )}
    >
      <Tip content={t({ ko: '모델이 나를 부르는 이름과 나에 대한 설명. 바꾸면 다음 요청부터 적용돼.', en: 'The name the models call you and what they know about you. Applies from the next request.' })} side="top">
        <span className="inline-flex">
          <ChatUserProfileSelect className="w-44" value={current?.id ?? null} profiles={profiles} disabled={mutation.isPending || profilesQuery.isPending} onChange={(id) => mutation.mutate(id)} ariaLabel={t({ ko: '사용자 프로필', en: 'User profile' })} />
        </span>
      </Tip>
    </SettingRow>
  )
}
