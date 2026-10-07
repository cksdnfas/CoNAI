import { useQueryClient } from '@tanstack/react-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPagePermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { createPromptPreset, updatePromptPreset, type PromptPresetMutationInput, type PromptPresetRecord } from '@/lib/api-prompt-presets'
import { useI18n } from '@/i18n'
import type { ChatPageData } from '@conai/shared'

export function presetChatSchema(parentIds: number[]) {
  return pageObject({ name: pageText(200), description: pageText(), parent_id: pageChoice([0, ...parentIds.filter((id) => id !== 0)].slice(0, 512)), items: pageArray(pageObject({ description: pageText(), value: pageText() }, ['description', 'value']), 128, 1) }, ['name', 'items'])
}
export function presetChatInput(args: Record<string, ChatPageData>, previous?: PromptPresetRecord | null): PromptPresetMutationInput {
  return { name: String(args.name ?? previous?.name ?? ''), description: String(args.description ?? previous?.description ?? ''), parent_id: args.parent_id === undefined ? previous?.parent_id ?? null : Number(args.parent_id) || null, items: (args.items ?? previous?.items ?? []) as PromptPresetMutationInput['items'] }
}
export function usePresetChatPage(presets: PromptPresetRecord[], selected: PromptPresetRecord | null, select: (id: number) => void, enabled = true) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const permissions = useChatPagePermissions()
  const schema = presetChatSchema(presets.map((item) => item.id))
  useChatPageRegistration(enabled ? {
    kind: 'presets', title: t({ ko: '프롬프트 프리셋', en: 'Prompt presets' }), resourceId: selected ? String(selected.id) : 'presets', fields: [],
    actions: [
      ...(presets.length ? [pageAction('preset.select', t({ ko: '프리셋 선택', en: 'Select preset' }), t({ ko: '목록의 프리셋을 선택해.', en: 'Select a listed preset.' }), pageObject({ id: pageChoice(presets.slice(0, 512).map((item) => item.id)) }, ['id']))] : []),
      ...(permissions.canCreatePrompts ? [pageAction('preset.create', t({ ko: '프리셋 생성', en: 'Create preset' }), t({ ko: '설명·프롬프트 값 쌍을 새 프리셋으로 저장해. parent_id 0은 최상위야.', en: 'Save description/prompt pairs as a new preset. parent_id 0 means root.' }), schema, 'save')] : []),
      ...(permissions.canUpdatePrompts && selected?.assistant_revision ? [pageAction('preset.update', t({ ko: '선택 프리셋 수정', en: 'Edit selected preset' }), t({ ko: '선택한 프리셋을 수정해. items는 전체 항목 목록이야.', en: 'Update the selected preset. items replaces the complete item list.' }), pageObject({ id: pageChoice([selected.id]), ...schema.properties }, ['id', ...schema.required!]), 'save')] : []),
    ],
    data: { presets: presets.slice(0, 512).map((item) => ({ id: item.id, name: item.name, parent_id: item.parent_id })), selected: selected ? { id: selected.id, name: selected.name, description: selected.description ?? '', parent_id: selected.parent_id ?? 0, items: (selected.items ?? []).map((item) => ({ description: item.description, value: item.value })), revision: selected.assistant_revision ?? '' } : null },
    apply: () => {},
    applyAction: async (id, args, assertCurrent, revision) => {
      assertCurrent()
      if (id === 'preset.select') { select(Number(args.id)); return }
      const input = presetChatInput(args, id === 'preset.update' ? selected : null)
      const result = id === 'preset.create' ? await createPromptPreset(input) : id === 'preset.update' ? await updatePromptPreset(Number(args.id), input, revision) : null
      if (!result) throw new Error('등록되지 않은 프리셋 작업이야.')
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
      select(result.id)
    },
  } : null)
}
