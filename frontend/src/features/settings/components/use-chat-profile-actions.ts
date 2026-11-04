import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { deleteChatProfile, getChatAdminProfile, listChatProfileNames, updateChatProfile, type ChatProfile, type ChatProfileInput } from '@/lib/api-codex-chat'

/** The library and editor operate on the same stored profile, with revision-checked moves. */
export function useChatProfileActions() {
  const { t } = useI18n()
  const confirm = useConfirm()
  return {
    copy: async (profile: ChatProfile): Promise<ChatProfileInput> => {
      const [full, profiles] = await Promise.all([getChatAdminProfile(profile.id), listChatProfileNames()])
      const base = t({ ko: '{name} 사본', en: '{name} copy' }, { name: full.name })
      const taken = new Set(profiles.map((entry) => entry.name))
      let name = base
      for (let count = 2; taken.has(name); count += 1) name = `${base} ${count}`
      return { ...full, name, suggestProfileId: full.suggestProfileId === full.id ? null : full.suggestProfileId }
    },
    move: (profile: ChatProfile, folderId: number | null) => updateChatProfile(profile.id, { folderId }, profile.revision),
    remove: async (profile: ChatProfile) => {
      if (!await confirm({
        title: t({ ko: '프로필 삭제', en: 'Delete profile' }),
        description: t({ ko: '‘{name}’ 프로필을 지울까? 이 프로필로 한 채팅은 남지만 더 보낼 수는 없어.', en: 'Delete ‘{name}’? Its chats stay but can no longer send.' }, { name: profile.name }),
        confirmLabel: t({ ko: '삭제', en: 'Delete' }),
        tone: 'destructive',
      })) return false
      await deleteChatProfile(profile.id)
      return true
    },
  }
}
