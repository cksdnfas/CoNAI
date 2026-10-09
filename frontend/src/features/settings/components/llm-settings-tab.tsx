import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { ChatSettingsJudge } from './chat-settings-judge'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmUsageDashboard } from './llm-usage-dashboard'
import { SETTINGS_TEXT_TAB_LIST_CLASS, SETTINGS_TEXT_TAB_TRIGGER_CLASS } from './settings-text-tabs'

type LlmSettingsView = 'dashboard' | 'connections' | 'judge'

/** `?view=` of the LLM tab; no value means the dashboard. */
function parseView(raw: string | null): LlmSettingsView {
  return raw === 'connections' || raw === 'judge' ? raw : 'dashboard'
}

/** Settings › LLM: text tabs for the usage dashboard, the connections (with chat diagnostics) and the judge log. */
export function LlmSettingsTab() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseView(searchParams.get('view'))

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
        <TabsTrigger value="judge" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '판단', en: 'Judge' })}</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard"><LlmUsageDashboard onOpenJudge={() => setView('judge')} /></TabsContent>
      <TabsContent value="connections"><LlmConnectionsTab /></TabsContent>
      <TabsContent value="judge"><ChatSettingsJudge /></TabsContent>
    </Tabs>
  )
}
