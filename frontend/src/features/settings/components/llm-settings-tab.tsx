import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { ChatDiagnosticsSettings } from './chat-options-settings'
import { ChatSettingsJudge } from './chat-settings-judge'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmPromptPresets } from './llm-prompt-presets'
import { LlmUsageDashboard } from './llm-usage-dashboard'
import { SETTINGS_TEXT_TAB_LIST_CLASS, SETTINGS_TEXT_TAB_TRIGGER_CLASS } from './settings-text-tabs'

type LlmSettingsView = 'dashboard' | 'connections' | 'prompts' | 'log'

/** `?view=` of the LLM tab; no value means the dashboard. The judge log of earlier links is now part of the log. */
function parseView(raw: string | null): LlmSettingsView {
  if (raw === 'judge') return 'log'
  return raw === 'connections' || raw === 'prompts' || raw === 'log' ? raw : 'dashboard'
}

/** Settings › LLM: text tabs for the usage dashboard, the connections, the workflow prompt presets and the log (answer diagnostics, judge log). */
export function LlmSettingsTab() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseView(searchParams.get('view'))

  // Topic criteria moved to Settings › 게시판 › 주제 관련도; old links land there.
  useEffect(() => {
    if (searchParams.get('view') === 'content-evaluation') setSearchParams({ section: 'posts', view: 'topics' }, { replace: true })
  }, [searchParams, setSearchParams])

  const setView = (next: string) => {
    const target = parseView(next)
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (target === 'dashboard') params.delete('view')
      else params.set('view', target)
      return params
    }, { replace: true })
  }

  return (
    <Tabs value={view} onValueChange={setView} className="gap-6">
      <TabsList className={SETTINGS_TEXT_TAB_LIST_CLASS}>
        <TabsTrigger value="dashboard" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '계기판', en: 'Dashboard' })}</TabsTrigger>
        <TabsTrigger value="connections" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '연결', en: 'Connections' })}</TabsTrigger>
        <TabsTrigger value="prompts" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '프롬프트', en: 'Prompts' })}</TabsTrigger>
        <TabsTrigger value="log" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '기록', en: 'Log' })}</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard"><LlmUsageDashboard onOpenJudge={() => setView('log')} /></TabsContent>
      <TabsContent value="connections"><LlmConnectionsTab /></TabsContent>
      <TabsContent value="prompts"><LlmPromptPresets /></TabsContent>
      <TabsContent value="log">
        <div className="space-y-8">
          <ChatDiagnosticsSettings />
          <ChatSettingsJudge />
        </div>
      </TabsContent>
    </Tabs>
  )
}
