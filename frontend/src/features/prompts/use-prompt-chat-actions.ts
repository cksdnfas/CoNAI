import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatPagePermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useI18n } from '@/i18n'
import { createPromptCollectionItem, getPromptCollectionItem, updatePromptCollectionItem, type PromptAuthorInput } from '@/lib/api-prompts'
import type { PromptCollectionItem, PromptGroupRecord, PromptTypeFilter } from '@/types/prompt'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { isLockedPromptItem, isLockedPromptGroup } from './prompt-page-utils'
import type { ChatPageData } from '@conai/shared'

export function usePromptChatActions(type: PromptTypeFilter, items: PromptCollectionItem[], groups: PromptGroupRecord[], selected: PromptCollectionItem | null, onSelect: (item: PromptCollectionItem) => void) {
  const queryClient = useQueryClient()
  const permissions = useChatPagePermissions()
  const { t } = useI18n()
  const detail = useQuery({ queryKey: ['chat-prompt-item', type, selected?.id], queryFn: () => getPromptCollectionItem(selected!.id, type), enabled: !!selected && permissions.canViewPrompts })
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const input = { type: pageChoice([type]), prompt: pageText(), synonyms: pageArray(pageText(), 100), group_id: pageChoice([0, ...groups.filter((group) => group.id !== 0 && !isLockedPromptGroup(group, groupMap)).map((group) => group.id)].slice(0, 512)) }
  const required = ['type', 'prompt', 'synonyms', 'group_id']
  const actions = [
    ...(items.length ? [pageAction('prompt.select', t({ ko: '프롬프트 선택', en: 'Select prompt' }), t({ ko: '현재 목록의 프롬프트를 선택해. 선택 뒤 새 요청으로 수정할 수 있어.', en: 'Select a current list item; request an edit after applying the selection.' }), pageObject({ id: pageChoice(items.map((item) => item.id)) }, ['id']))] : []),
    ...(permissions.canCreatePrompts ? [pageAction('prompt.create', t({ ko: '프롬프트 생성', en: 'Create prompt' }), t({ ko: '새 본문과 동의어·그룹을 프롬프트 보관함에 저장해. group_id 0은 미분류야.', en: 'Save a new prompt, synonyms and group. group_id 0 means ungrouped.' }), pageObject(input, required), 'save')] : []),
    ...(permissions.canUpdatePrompts && detail.data && selected && !isLockedPromptItem(selected, groupMap) ? [pageAction('prompt.update', t({ ko: '선택 프롬프트 수정', en: 'Edit selected prompt' }), t({ ko: '선택한 프롬프트의 본문·동의어·그룹을 수정해. 사용 횟수는 보존해.', en: 'Edit the selected prompt, synonyms and group while preserving usage counts.' }), pageObject({ id: pageChoice([selected.id]), ...input }, ['id', ...required]), 'save')] : []),
  ]
  return {
    actions,
    data: { prompts: items.map((item) => ({ id: item.id, prompt: item.prompt, type: item.type, group_id: item.group_id })), groups: groups.slice(0, 512).map((group) => ({ id: group.id, name: group.group_name })), selected: detail.data ? { id: detail.data.id, type, prompt: detail.data.prompt, synonyms: detail.data.synonyms, group_id: detail.data.group_id ?? 0, revision: detail.data.assistant_revision } : null },
    applyAction: async (id: string, args: Record<string, ChatPageData>, assertCurrent: () => void, revision?: string) => {
      assertCurrent()
      if (id === 'prompt.select') { const item = items.find((entry) => entry.id === args.id); if (!item) throw new Error('선택할 프롬프트가 바뀌었어.'); onSelect(item); return }
      const input: PromptAuthorInput = { type, prompt: String(args.prompt), synonyms: args.synonyms as string[], group_id: Number(args.group_id) || null }
      if (id === 'prompt.create') await createPromptCollectionItem(input)
      else if (id === 'prompt.update') await updatePromptCollectionItem(Number(args.id), input, revision)
      else throw new Error('등록되지 않은 프롬프트 작업이야.')
      await Promise.all(['prompt-search', 'prompt-top', 'prompt-statistics', 'prompt-group-statistics', 'chat-prompt-item'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    },
  }
}
