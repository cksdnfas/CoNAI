import { useSearchParams } from 'react-router-dom'
import { SettingsContents, SettingsGroup } from './settings-navigation'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { useI18n } from '@/i18n'
import { ChatDiagnosticsSettings } from './chat-options-settings'
import { ChatSettingsJudge } from './chat-settings-judge'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmPromptPresets } from './llm-prompt-presets'
import { LlmUsageDashboard } from './llm-usage-dashboard'

/** One scrolling AI page, with stable group links instead of nested tabs. */
export function LlmSettingsTab() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const groups = ['connections', 'dashboard', 'prompts', 'log'].map((id) => ({ id, label: t(SETTINGS_ROW_BY_ID[`llm.${id}`].label) }))
  return <div className="space-y-8">
    <SettingsContents groups={groups} />
    {groups.map((group) => <SettingsGroup key={group.id} id={group.id} title={group.label}><div data-setting-id={`llm.${group.id}`}>
      {group.id === 'connections' ? <LlmConnectionsTab /> : group.id === 'dashboard' ? <LlmUsageDashboard onOpenJudge={() => { const next = new URLSearchParams(searchParams); next.set('group', 'log'); next.delete('setting'); setSearchParams(next) }} /> : group.id === 'prompts' ? <LlmPromptPresets /> : <div className="space-y-8"><ChatDiagnosticsSettings /><ChatSettingsJudge /></div>}
    </div></SettingsGroup>)}
  </div>
}
