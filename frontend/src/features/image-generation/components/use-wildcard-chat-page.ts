import { useQueryClient } from '@tanstack/react-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { createWildcard, updateWildcard, type WildcardRecord, type WildcardMutationInput } from '@/lib/api-wildcards'
import { useI18n } from '@/i18n'
import type { ChatPageData } from '@conai/shared'

export function wildcardChatSchema(parentIds: number[]) {
  const items = pageArray(pageObject({ content: pageText(), weight: pageNumber(0.001, 100000) }, ['content', 'weight']), 128)
  return pageObject({ name: pageText(200), description: pageText(), parent_id: pageChoice([0, ...parentIds.filter((id) => id !== 0)].slice(0, 512)), include_children: { type: 'boolean' }, only_children: { type: 'boolean' }, type: pageChoice(['wildcard', 'chain']), chain_option: pageChoice(['replace', 'append']), items: pageObject({ general: items, nai: items, comfyui: items }, ['general', 'nai', 'comfyui']) }, ['name', 'items'])
}
export function wildcardChatInput(args: Record<string, ChatPageData>, previous?: WildcardRecord | null): WildcardMutationInput {
  return { name: String(args.name ?? previous?.name ?? ''), description: String(args.description ?? previous?.description ?? ''), parent_id: args.parent_id === undefined ? previous?.parent_id ?? null : Number(args.parent_id) || null,
    include_children: args.include_children === undefined ? previous?.include_children ?? 0 : Number(args.include_children), only_children: args.only_children === undefined ? previous?.only_children ?? 0 : Number(args.only_children), type: (args.type ?? previous?.type ?? 'wildcard') as 'wildcard' | 'chain', chain_option: (args.chain_option ?? previous?.chain_option ?? 'replace') as 'replace' | 'append', items: args.items as WildcardMutationInput['items'] }
}
export function useWildcardChatPage(input: { records: WildcardRecord[]; selected: WildcardRecord | null; select: (id: number) => void; search: string; setSearch: (value: string) => void; canCreate: boolean; canEdit: boolean; enabled: boolean }) {
  const { records, selected, select, search, setSearch, canCreate, canEdit, enabled } = input
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const schema = wildcardChatSchema(records.map((item) => item.id))
  useChatPageRegistration(enabled ? {
    kind: 'wildcards', title: t({ ko: '와일드카드·체인', en: 'Wildcards and chains' }), resourceId: selected ? String(selected.id) : 'wildcards',
    fields: [{ id: 'search', label: t({ ko: '검색', en: 'Search' }), type: 'text', value: search }],
    actions: [
      ...(records.length ? [pageAction('wildcard.select', t({ ko: '와일드카드 선택', en: 'Select wildcard' }), t({ ko: '현재 목록의 항목을 선택해.', en: 'Select a current list item.' }), pageObject({ id: pageChoice(records.slice(0, 512).map((item) => item.id)) }, ['id']))] : []),
      ...(canCreate ? [pageAction('wildcard.create', t({ ko: '와일드카드·체인 추가', en: 'Create wildcard or chain' }), t({ ko: '일반·NAI·ComfyUI 항목과 가중치를 저장해. parent_id 0은 최상위야.', en: 'Save General, NAI and ComfyUI items and weights. parent_id 0 means root.' }), schema, 'save')] : []),
      ...(canEdit && selected?.assistant_revision ? [pageAction('wildcard.update', t({ ko: '선택 와일드카드 수정', en: 'Edit selected wildcard' }), t({ ko: '선택 항목의 내용·가중치·계층·체인을 수정해. items는 전체 목록을 교체해.', en: 'Edit contents, weights, hierarchy and chain settings. items replaces the entire list.' }), pageObject({ id: pageChoice([selected.id]), ...schema.properties }, ['id', ...schema.required!]), 'save')] : []),
    ],
    data: { wildcards: records.slice(0, 512).map((item) => ({ id: item.id, name: item.name, type: item.type, parent_id: item.parent_id })), selected: selected ? { id: selected.id, name: selected.name, description: selected.description ?? '', parent_id: selected.parent_id ?? 0, type: selected.type, chain_option: selected.chain_option, include_children: !!selected.include_children, only_children: !!selected.only_children, items: (selected.items ?? []).map((item) => ({ tool: item.tool, content: item.content, weight: item.weight })), revision: selected.assistant_revision ?? '' } : null },
    apply: (patch) => { if (patch.search !== undefined) setSearch(String(patch.search)) },
    applyAction: async (id, args, assertCurrent, revision) => {
      assertCurrent()
      if (id === 'wildcard.select') { select(Number(args.id)); return }
      const data = wildcardChatInput(args, id === 'wildcard.update' ? selected : null)
      const result = id === 'wildcard.create' ? await createWildcard(data) : id === 'wildcard.update' ? await updateWildcard(Number(args.id), data, revision) : null
      if (!result) throw new Error('등록되지 않은 와일드카드 작업이야.')
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      select(result.id)
    },
  } : null)
}
