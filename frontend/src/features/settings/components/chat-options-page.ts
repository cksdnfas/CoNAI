import { CHAT_CAPTURE_LIMITS, normalizeLoreKeyLanguage, type ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { LORE_SELECTION_LIMITS, TOOL_ROUND_LIMITS, type WebResearchSettings } from '@/lib/api-codex-chat'
import { useChatOptions } from './chat-options-settings'

const ACTION_ID = 'settings.chat_options'

/**
 * Settings › 채팅 › the chat-wide options (memory, tool use, web search, answer diagnostics) for a connected chat:
 * `data.chatOptions` and one save action. `active` is whether the addressed group is one of them (Settings keeps
 * every group of the section mounted, and only one owns the page snapshot).
 */
export function useChatOptionsPageRegistration(active: boolean) {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions({ reportErrors: false })
  const settings = settingsQuery.data

  const chatOptions: ChatPageData = settings ? {
    loreAutoSave: settings.loreAutoSave, loreSelectionLimit: settings.loreSelectionLimit, loreKeyLanguage: settings.loreKeyLanguage,
    toolRoundLimit: settings.toolRoundLimit, piCodemode: settings.piCodemode,
    webEngine: settings.webResearch.engine, webModel: settings.webResearch.model, webDailyLimit: settings.webResearch.dailyLimit,
    diagnosticsEnabled: settings.diagnostics.enabled, diagnosticsCaptureRaw: settings.diagnostics.captureRaw, diagnosticsKeepPerChat: settings.diagnostics.captureLimit,
  } : null

  const save = async (args: Record<string, ChatPageData>) => {
    const webResearch: Partial<WebResearchSettings> = {}
    const diagnostics: { enabled?: boolean; captureRaw?: boolean; captureLimit?: number } = {}
    if (typeof args.webEngine === 'string') webResearch.engine = args.webEngine as WebResearchSettings['engine']
    if (typeof args.webModel === 'string') webResearch.model = args.webModel.trim() || null
    else if (webResearch.engine && webResearch.engine !== settings?.webResearch.engine) webResearch.model = null
    if (typeof args.webDailyLimit === 'number') webResearch.dailyLimit = args.webDailyLimit > 0 ? args.webDailyLimit : null
    if (typeof args.diagnosticsEnabled === 'boolean') diagnostics.enabled = args.diagnosticsEnabled
    if (typeof args.diagnosticsCaptureRaw === 'boolean') diagnostics.captureRaw = args.diagnosticsCaptureRaw
    if (typeof args.diagnosticsKeepPerChat === 'number') diagnostics.captureLimit = args.diagnosticsKeepPerChat
    const patch = {
      ...(typeof args.loreAutoSave === 'boolean' ? { loreAutoSave: args.loreAutoSave } : {}),
      ...(typeof args.loreSelectionLimit === 'number' ? { loreSelectionLimit: args.loreSelectionLimit } : {}),
      ...(typeof args.loreKeyLanguage === 'string' ? { loreKeyLanguage: normalizeLoreKeyLanguage(args.loreKeyLanguage) } : {}),
      ...(typeof args.toolRoundLimit === 'number' ? { toolRoundLimit: args.toolRoundLimit } : {}),
      ...(typeof args.piCodemode === 'boolean' ? { piCodemode: args.piCodemode } : {}),
      ...(Object.keys(webResearch).length ? { webResearch } : {}),
      ...(Object.keys(diagnostics).length ? { diagnostics } : {}),
    }
    if (!Object.keys(patch).length) throw new Error('바꿀 설정이 없어.')
    await settingsMutation.mutateAsync(patch)
  }

  useChatPageRegistration(active ? {
    kind: 'settings', title: t({ ko: '설정 · 채팅', en: 'Settings · Chat' }), resourceId: 'chat', priority: 5, fields: [], data: { section: 'chat', chatOptions },
    actions: [pageAction(ACTION_ID, t({ ko: '채팅 공통 설정 저장', en: 'Save chat-wide options' }), t({
      ko: 'data.chatOptions의 값을 바로 저장해(넘긴 것만). loreKeyLanguage 빈 값 = 영어만, webEngine off = 웹 도구 없음, webModel 빈 값 = 기본, webDailyLimit 0 = 제한 없음. toolRoundLimit = 모든 프로필·플러그인 실행의 한 답변당 도구 왕복 한도, piCodemode = pi 프로필이 스크립트로 도구를 묶어 호출.',
      en: 'Save values of data.chatOptions right away (only those passed). loreKeyLanguage empty = English only, webEngine off = no web tools, webModel empty = default, webDailyLimit 0 = no limit. toolRoundLimit = tool round trips per reply for every profile and plugin run, piCodemode = pi profiles call tools through scripts.',
    }), pageObject({
      loreAutoSave: { type: 'boolean' }, loreSelectionLimit: pageNumber(LORE_SELECTION_LIMITS.min, LORE_SELECTION_LIMITS.max, true), loreKeyLanguage: pageText(40),
      toolRoundLimit: pageNumber(TOOL_ROUND_LIMITS.min, TOOL_ROUND_LIMITS.max, true), piCodemode: { type: 'boolean' },
      webEngine: pageChoice(['off', 'codex', 'claude']), webModel: pageText(120), webDailyLimit: pageNumber(0, 1000, true),
      diagnosticsEnabled: { type: 'boolean' }, diagnosticsCaptureRaw: { type: 'boolean' }, diagnosticsKeepPerChat: pageNumber(CHAT_CAPTURE_LIMITS.min, CHAT_CAPTURE_LIMITS.max, true),
    }), 'save')],
    apply: () => {},
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      if (id !== ACTION_ID) throw new Error('이 화면에 없는 작업이야.')
      return save(args)
    },
  } : null, { preserveOnSearchChange: true })
}
