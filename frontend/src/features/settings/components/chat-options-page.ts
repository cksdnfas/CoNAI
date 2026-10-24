import { CHAT_CAPTURE_LIMITS, normalizeLoreKeyLanguage, type ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { TOOL_ROUND_LIMITS, type WebResearchSettings } from '@/lib/api-codex-chat'
import { useChatOptions } from './chat-options-settings'

/** Which chat-wide options a page shows: memory, tool use and web (Settings › 채팅 › 자원) or answer diagnostics (Settings › LLM › 기록). */
export type ChatOptionsScope = 'memory-web' | 'diagnostics'

const ACTION_ID = 'settings.chat_options'

/**
 * The chat-wide options of one page for a connected chat: `chatOptions` for its data, one save action, and `apply`,
 * which handles that action (undefined for any other id).
 */
export function useChatOptionsPageParts(scope: ChatOptionsScope) {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions({ reportErrors: false })
  const settings = settingsQuery.data
  const memoryWeb = scope === 'memory-web'

  const chatOptions: ChatPageData = settings ? (memoryWeb ? {
    loreAutoSave: settings.loreAutoSave, loreKeyLanguage: settings.loreKeyLanguage,
    webEngine: settings.webResearch.engine, webModel: settings.webResearch.model, webDailyLimit: settings.webResearch.dailyLimit,
    toolRoundLimit: settings.toolRoundLimit,
  } : {
    diagnosticsEnabled: settings.diagnostics.enabled, diagnosticsCaptureRaw: settings.diagnostics.captureRaw, diagnosticsKeepPerChat: settings.diagnostics.captureLimit,
  }) : null

  const action = memoryWeb
    ? pageAction(ACTION_ID, t({ ko: '채팅 공통 설정 저장', en: 'Save chat-wide options' }), t({
      ko: 'data.chatOptions의 값을 바로 저장해(넘긴 것만). loreKeyLanguage 빈 값 = 영어만, webEngine off = 웹 도구 없음, webModel 빈 값 = 기본, webDailyLimit 0 = 제한 없음. toolRoundLimit = 모든 프로필·플러그인 실행의 한 답변당 도구 왕복 한도.',
      en: 'Save values of data.chatOptions right away (only those passed). loreKeyLanguage empty = English only, webEngine off = no web tools, webModel empty = default, webDailyLimit 0 = no limit. toolRoundLimit = tool round trips per reply for every profile and plugin run.',
    }), pageObject({
      loreAutoSave: { type: 'boolean' }, loreKeyLanguage: pageText(40),
      webEngine: pageChoice(['off', 'codex', 'claude']), webModel: pageText(120), webDailyLimit: pageNumber(0, 1000, true),
      toolRoundLimit: pageNumber(TOOL_ROUND_LIMITS.min, TOOL_ROUND_LIMITS.max, true),
    }), 'save')
    : pageAction(ACTION_ID, t({ ko: '답변 진단 설정 저장', en: 'Save answer diagnostics' }), t({
      ko: 'data.chatOptions의 값을 바로 저장해(넘긴 것만).',
      en: 'Save values of data.chatOptions right away (only those passed).',
    }), pageObject({
      diagnosticsEnabled: { type: 'boolean' }, diagnosticsCaptureRaw: { type: 'boolean' }, diagnosticsKeepPerChat: pageNumber(CHAT_CAPTURE_LIMITS.min, CHAT_CAPTURE_LIMITS.max, true),
    }), 'save')

  const save = async (args: Record<string, ChatPageData>) => {
    const webResearch: Partial<WebResearchSettings> = {}
    const diagnostics: { enabled?: boolean; captureRaw?: boolean; captureLimit?: number } = {}
    if (memoryWeb) {
      if (typeof args.webEngine === 'string') webResearch.engine = args.webEngine as WebResearchSettings['engine']
      if (typeof args.webModel === 'string') webResearch.model = args.webModel.trim() || null
      else if (webResearch.engine && webResearch.engine !== settings?.webResearch.engine) webResearch.model = null
      if (typeof args.webDailyLimit === 'number') webResearch.dailyLimit = args.webDailyLimit > 0 ? args.webDailyLimit : null
    } else {
      if (typeof args.diagnosticsEnabled === 'boolean') diagnostics.enabled = args.diagnosticsEnabled
      if (typeof args.diagnosticsCaptureRaw === 'boolean') diagnostics.captureRaw = args.diagnosticsCaptureRaw
      if (typeof args.diagnosticsKeepPerChat === 'number') diagnostics.captureLimit = args.diagnosticsKeepPerChat
    }
    const patch = {
      ...(memoryWeb && typeof args.loreAutoSave === 'boolean' ? { loreAutoSave: args.loreAutoSave } : {}),
      ...(memoryWeb && typeof args.loreKeyLanguage === 'string' ? { loreKeyLanguage: normalizeLoreKeyLanguage(args.loreKeyLanguage) } : {}),
      ...(memoryWeb && typeof args.toolRoundLimit === 'number' ? { toolRoundLimit: args.toolRoundLimit } : {}),
      ...(Object.keys(webResearch).length ? { webResearch } : {}),
      ...(Object.keys(diagnostics).length ? { diagnostics } : {}),
    }
    if (!Object.keys(patch).length) throw new Error('바꿀 설정이 없어.')
    await settingsMutation.mutateAsync(patch)
  }

  return {
    data: { chatOptions },
    actions: [action],
    apply: (id: string, args: Record<string, ChatPageData>) => (id === ACTION_ID ? save(args) : undefined),
  }
}
