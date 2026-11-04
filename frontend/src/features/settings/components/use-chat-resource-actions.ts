import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_GENERATION_PRESETS_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SKILLS_QUERY_KEY,
  CHAT_TOOL_PRESETS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  deleteChatBlock,
  deleteChatGenerationPreset,
  deleteChatLorebook,
  deleteChatSkill,
  deleteChatToolPreset,
  deleteOwnLorebook,
  downloadChatSkillExport,
  listChatGenerationPresets,
  type ChatGenerationPreset,
  type ChatLorebook,
  type ChatSharedBlock,
  type ChatSkillSummary,
  type ChatToolPreset,
} from '@/lib/api-codex-chat'
import { CHAT_JUDGE_PRESETS_QUERY_KEY, deleteChatJudgePreset, type ChatJudgePreset } from '@/lib/api-chat-judge'
import { getErrorMessage } from '@/lib/error-message'
import { presetsGuidedBy } from './chat-skill-draft'

type SkillTarget = Pick<ChatSkillSummary, 'id' | 'name' | 'source' | 'profiles'>
type DeleteTarget =
  | { kind: 'tool'; resource: ChatToolPreset }
  | { kind: 'generation'; resource: ChatGenerationPreset }
  | { kind: 'block'; resource: ChatSharedBlock }
  | { kind: 'skill'; resource: SkillTarget }
  | { kind: 'judge'; resource: ChatJudgePreset }
  | { kind: 'lorebook'; resource: ChatLorebook }

const REFRESH_KEYS = {
  tool: [CHAT_TOOL_PRESETS_QUERY_KEY, CHAT_PROFILES_QUERY_KEY],
  generation: [CHAT_GENERATION_PRESETS_QUERY_KEY],
  block: [CHAT_BLOCKS_QUERY_KEY, CHAT_PROFILES_QUERY_KEY],
  skill: [CHAT_SKILLS_QUERY_KEY, CHAT_PROFILES_QUERY_KEY, CHAT_GENERATION_PRESETS_QUERY_KEY],
  judge: [CHAT_JUDGE_PRESETS_QUERY_KEY],
  lorebook: [CHAT_LOREBOOKS_QUERY_KEY, OWN_LOREBOOKS_QUERY_KEY],
} as const

/** Lists and editors share deletion checks, named confirmation and cache updates. */
export function useChatResourceDelete(onDeleted?: () => void) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ remove }: { target: DeleteTarget; remove: () => Promise<unknown> }) => remove(),
    onSuccess: async (_, { target }) => {
      // Leave a deleted editor before its detail can be refetched by the list invalidation.
      onDeleted?.()
      await Promise.all([CHAT_ADMIN_PROFILES_QUERY_KEY, ...REFRESH_KEYS[target.kind]].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const requestDelete = async (target: DeleteTarget) => {
    let title: string
    let description = ''
    let remove: () => Promise<unknown>
    switch (target.kind) {
      case 'tool':
        title = t({ ko: '도구 프리셋 삭제', en: 'Delete tool preset' })
        remove = () => deleteChatToolPreset(target.resource.id)
        break
      case 'generation': {
        const linked = target.resource.profiles.length
        if (linked > 0) {
          showSnackbar({ message: t({ ko: '프로필 {count}개가 쓰는 중이야. 먼저 그 프로필에서 연결을 풀어줘.', en: 'Used by {count} profiles. Unlink it there first.' }, { count: linked }), tone: 'error' })
          return
        }
        title = t({ ko: '생성 프리셋 삭제', en: 'Delete generation preset' })
        remove = () => deleteChatGenerationPreset(target.resource.id)
        break
      }
      case 'block':
      case 'lorebook': {
        title = target.kind === 'block' ? t({ ko: '표시 블록 삭제', en: 'Delete display block' }) : t({ ko: '로어북 삭제', en: 'Delete lorebook' })
        const linked = target.resource.profiles.length
        if (linked > 0) description = t({ ko: '프로필 {count}개에서 쓰는 중이야. 지우면 연결도 같이 풀려.', en: 'Used by {count} profiles. Deleting also unlinks it from them.' }, { count: linked })
        remove = target.kind === 'block'
          ? () => deleteChatBlock(target.resource.id)
          : () => target.resource.kind && target.resource.kind !== 'global' ? deleteOwnLorebook(target.resource.id) : deleteChatLorebook(target.resource.id)
        break
      }
      case 'skill': {
        if (target.resource.source === 'plugin') return
        title = t({ ko: '스킬 삭제', en: 'Delete skill' })
        let presets: ChatGenerationPreset[]
        try {
          presets = queryClient.getQueryData<ChatGenerationPreset[]>(CHAT_GENERATION_PRESETS_QUERY_KEY)
            ?? await queryClient.fetchQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets })
        } catch (error) {
          showSnackbar({ message: getErrorMessage(error, t({ ko: '스킬 사용 정보를 불러오지 못했어.', en: 'Could not load skill usage.' })), tone: 'error' })
          return
        }
        const guides = presetsGuidedBy(presets, target.resource.id, null)
        description = [
          target.resource.profiles.length > 0 ? t({ ko: '이 스킬을 지우면 연결한 프로필 {count}개에서도 빠져.', en: 'Deleting this skill also unlinks it from {count} profiles.' }, { count: target.resource.profiles.length }) : '',
          guides.length > 0 ? t({ ko: '생성 프리셋 {names}의 가이드도 찾을 수 없게 돼.', en: 'The guide of generation presets {names} will be gone too.' }, { names: guides.join(', ') }) : '',
        ].filter(Boolean).join(' ')
        remove = () => deleteChatSkill(target.resource.id)
        break
      }
      case 'judge': {
        title = t({ ko: '판단 프리셋 삭제', en: 'Delete judge preset' })
        const using = target.resource.profiles.length + target.resource.rooms.length
        if (using > 0) description = t({ ko: '프로필·그룹 방 {count}개가 이 프리셋을 써. 지우면 판단 없이 동작해.', en: '{count} profiles and rooms use it. They will chat without a judge.' }, { count: using })
        remove = () => deleteChatJudgePreset(target.resource.id)
        break
      }
    }
    const confirmed = await confirm({
      title,
      description: [t({ ko: '"{name}"을(를) 지울까?', en: 'Delete "{name}"?' }, { name: target.resource.name }), description].filter(Boolean).join(' '),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) mutation.mutate({ target, remove })
  }

  return { mutate: requestDelete, isPending: mutation.isPending }
}

export function useChatSkillExport() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  return useMutation({
    mutationFn: (skill: Pick<ChatSkillSummary, 'id' | 'name'>) => downloadChatSkillExport(skill.id, skill.name),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '내보내지 못했어.', en: 'Could not export.' })), tone: 'error' }),
  })
}
