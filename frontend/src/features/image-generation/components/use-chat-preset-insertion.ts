import { useQuery } from '@tanstack/react-query'
import { useChatPage } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useChatPagePermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { buildPromptPresetInsertionText, getPromptPresets } from '@/lib/api-prompt-presets'
import { useI18n } from '@/i18n'
import { CHAT_PAGE_LIMITS, type ChatPageData } from '@conai/shared'
import type { TextSegmentSpreadsheetValue } from './prompt-text-segment-helpers'

export function useChatPresetInsertion(targets: string[]) {
  const page = useChatPage()
  const { canViewPrompts } = useChatPagePermissions()
  const { t } = useI18n()
  const presets = useQuery({ queryKey: ['prompt-presets', 'chat-assets'], queryFn: () => getPromptPresets({ withItems: true }), enabled: !!page?.enabled && canViewPrompts })
  const records = canViewPrompts ? (presets.data ?? []).slice(0, 512) : []
  return {
    actions: targets.length && records.length ? [pageAction('preset.insert', t({ ko: '프리셋 입력', en: 'Insert preset' }), t({ ko: '선택한 프리셋의 설명·프롬프트를 입력해. append는 덧붙이기, replace는 전체 교체야.', en: 'Insert a preset. append adds to the input; replace replaces the complete input.' }), pageObject({ presetId: pageChoice(records.map((item) => item.id)), fieldId: pageChoice(targets), mode: pageChoice(['append', 'replace']) }, ['presetId', 'fieldId', 'mode']))] : [],
    candidates: records.map((item) => ({ id: item.id, name: item.name })),
    value: (args: Record<string, ChatPageData>, before: string) => {
      if (!canViewPrompts) throw new Error(t({ ko: '프리셋 조회 권한이 없어.', en: 'Preset viewing permission is required.' }))
      const preset = records.find((item) => item.id === args.presetId)
      if (!preset) throw new Error('프리셋이 바뀌었어. 다시 읽어줘.')
      const value = buildPromptPresetInsertionText(preset)
      return insertChatPageText(args.mode, before, value, (current) => (current ? `${current}\n\n${value}` : value), '프리셋을 적용하면 입력이 너무 길어져.')
    },
  }
}

/**
 * Assistant text insertion into a page input: `replace` puts `replacement` in, anything else appends with the
 * action's own separator rule (`append`). The result must fit the page text limit.
 */
export function insertChatPageText<T extends TextSegmentSpreadsheetValue>(mode: ChatPageData | undefined, before: T, replacement: T, append: (before: T) => T, tooLong: string): T {
  const value = mode === 'replace' ? replacement : append(before)
  if ((Array.isArray(value) ? value.join('\n') : value).length > CHAT_PAGE_LIMITS.text) throw new Error(tooLong)
  return value
}
