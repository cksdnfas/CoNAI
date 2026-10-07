import { useQuery } from '@tanstack/react-query'
import { useChatPage } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useChatPagePermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { buildPromptPresetInsertionText, getPromptPresets } from '@/lib/api-prompt-presets'
import { useI18n } from '@/i18n'
import type { ChatPageData } from '@conai/shared'

export function useChatPresetInsertion(targets: string[]) {
  const page = useChatPage()
  const { canViewPrompts } = useChatPagePermissions()
  const { t } = useI18n()
  const presets = useQuery({ queryKey: ['prompt-presets', 'chat-insertion'], queryFn: () => getPromptPresets({ withItems: true }), enabled: !!page?.enabled && canViewPrompts })
  const records = canViewPrompts ? (presets.data ?? []).slice(0, 512) : []
  return {
    actions: targets.length && records.length ? [pageAction('preset.insert', t({ ko: '프리셋 입력', en: 'Insert preset' }), t({ ko: '선택한 프리셋의 설명·프롬프트를 입력해. append는 덧붙이기, replace는 전체 교체야.', en: 'Insert a preset. append adds to the input; replace replaces the complete input.' }), pageObject({ presetId: pageChoice(records.map((item) => item.id)), fieldId: pageChoice(targets), mode: pageChoice(['append', 'replace']) }, ['presetId', 'fieldId', 'mode']))] : [],
    candidates: records.map((item) => ({ id: item.id, name: item.name })),
    value: (args: Record<string, ChatPageData>, before: string) => {
      if (!canViewPrompts) throw new Error(t({ ko: '프리셋 조회 권한이 없어.', en: 'Preset viewing permission is required.' }))
      const preset = records.find((item) => item.id === args.presetId)
      if (!preset) throw new Error('프리셋이 바뀌었어. 다시 읽어줘.')
      const value = buildPromptPresetInsertionText(preset)
      const result = args.mode === 'replace' || !before ? value : `${before}\n\n${value}`
      if (result.length > 8000) throw new Error('프리셋을 적용하면 입력이 너무 길어져.')
      return result
    },
  }
}
