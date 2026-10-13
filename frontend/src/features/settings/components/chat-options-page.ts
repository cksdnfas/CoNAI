import { useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeLoreKeyLanguage, type ChatPageData } from '@conai/shared'
import { useI18n } from '@/i18n'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { CHAT_ADMIN_SETTINGS_QUERY_KEY, CHAT_STATUS_QUERY_KEY, getChatAdminSettings, updateChatAdminSettings, type WebResearchSettings } from '@/lib/api-codex-chat'

/** Which chat-wide options a page shows: memory and web (Settings › 채팅 › 자원) or answer diagnostics (Settings › LLM › 기록). */
export type ChatOptionsScope = 'memory-web' | 'diagnostics'

const ACTION_ID = 'settings.chat_options'

/**
 * The chat-wide options of one page for a connected chat: `chatOptions` for its data, one save action, and `apply`,
 * which handles that action (undefined for any other id).
 */
export function useChatOptionsPageParts(scope: ChatOptionsScope) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: CHAT_ADMIN_SETTINGS_QUERY_KEY, queryFn: getChatAdminSettings }).data
  const memoryWeb = scope === 'memory-web'

  const chatOptions: ChatPageData = settings ? (memoryWeb ? {
    loreAutoSave: settings.loreAutoSave, loreKeyLanguage: settings.loreKeyLanguage,
    webEngine: settings.webResearch.engine, webModel: settings.webResearch.model, webDailyLimit: settings.webResearch.dailyLimit,
  } : {
    diagnosticsEnabled: settings.diagnostics.enabled, diagnosticsCaptureRaw: settings.diagnostics.captureRaw, diagnosticsKeepPerChat: settings.diagnostics.captureLimit,
  }) : null

  const action = memoryWeb
    ? pageAction(ACTION_ID, t({ ko: '채팅 공통 설정 저장', en: 'Save chat-wide options' }), t({
      ko: 'data.chatOptions의 값을 바로 저장해(넘긴 것만). loreKeyLanguage 빈 값 = 영어만, webEngine off = 웹 도구 없음, webModel 빈 값 = 기본, webDailyLimit 0 = 제한 없음.',
      en: 'Save values of data.chatOptions right away (only those passed). loreKeyLanguage empty = English only, webEngine off = no web tools, webModel empty = default, webDailyLimit 0 = no limit.',
    }), pageObject({
      loreAutoSave: { type: 'boolean' }, loreKeyLanguage: pageText(40),
      webEngine: pageChoice(['off', 'codex', 'claude']), webModel: pageText(120), webDailyLimit: pageNumber(0, 1000, true),
    }), 'save')
    : pageAction(ACTION_ID, t({ ko: '답변 진단 설정 저장', en: 'Save answer diagnostics' }), t({
      ko: 'data.chatOptions의 값을 바로 저장해(넘긴 것만).',
      en: 'Save values of data.chatOptions right away (only those passed).',
    }), pageObject({
      diagnosticsEnabled: { type: 'boolean' }, diagnosticsCaptureRaw: { type: 'boolean' }, diagnosticsKeepPerChat: pageNumber(1, 200, true),
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
      ...(Object.keys(webResearch).length ? { webResearch } : {}),
      ...(Object.keys(diagnostics).length ? { diagnostics } : {}),
    }
    if (!Object.keys(patch).length) throw new Error('바꿀 설정이 없어.')
    queryClient.setQueryData(CHAT_ADMIN_SETTINGS_QUERY_KEY, await updateChatAdminSettings(patch))
    void queryClient.invalidateQueries({ queryKey: CHAT_STATUS_QUERY_KEY })
  }

  return {
    data: { chatOptions },
    actions: [action],
    apply: (id: string, args: Record<string, ChatPageData>) => (id === ACTION_ID ? save(args) : undefined),
  }
}
