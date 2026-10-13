import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TextTabs } from '@/components/common/text-tabs'
import { TabsContent } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { ChatDiagnosticsSettings } from './chat-options-settings'
import { ChatSettingsJudge } from './chat-settings-judge'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmPromptPresets } from './llm-prompt-presets'
import { LlmUsageDashboard } from './llm-usage-dashboard'

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
    <TextTabs
      value={view}
      onChange={setView}
      className="gap-6"
      items={[
        { value: 'dashboard', label: t({ ko: '계기판', en: 'Dashboard' }) },
        { value: 'connections', label: t({ ko: '연결', en: 'Connections' }) },
        { value: 'prompts', label: t({ ko: '프롬프트', en: 'Prompts' }) },
        { value: 'log', label: t({ ko: '기록', en: 'Log' }) },
      ]}
    >
      <TabsContent value="dashboard"><LlmUsageDashboard onOpenJudge={() => setView('log')} /></TabsContent>
      <TabsContent value="connections"><LlmConnectionsTab /></TabsContent>
      <TabsContent value="prompts"><LlmPromptPresets /></TabsContent>
      <TabsContent value="log">
        <div className="space-y-8">
          <ChatDiagnosticsSettings />
          <ChatSettingsJudge />
        </div>
      </TabsContent>
    </TextTabs>
  )
}
