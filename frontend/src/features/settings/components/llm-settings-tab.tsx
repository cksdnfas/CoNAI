import { useSearchParams } from 'react-router-dom'
import { SettingsContents, SettingsGroup } from './settings-navigation'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { useI18n } from '@/i18n'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmPromptPresets } from './llm-prompt-presets'
import { LlmUsageDashboard } from './llm-usage-dashboard'

/** One scrolling AI page, with stable group links instead of nested tabs. The chat's own records live in Settings › 채팅. */
export function LlmSettingsTab() {
  const { t } = useI18n()
  const [, setSearchParams] = useSearchParams()
  const groups = ['connections', 'dashboard', 'prompts'].map((id) => ({ id, label: t(SETTINGS_ROW_BY_ID[`llm.${id}`].label) }))
  return <div className="space-y-8">
    <SettingsContents groups={groups} />
    {groups.map((group) => <SettingsGroup key={group.id} id={group.id} title={group.label}><div data-setting-id={`llm.${group.id}`}>
      {group.id === 'connections' ? <LlmConnectionsTab /> : group.id === 'dashboard' ? <LlmUsageDashboard onOpenJudge={() => setSearchParams({ section: 'chat', group: 'judge' })} /> : <LlmPromptPresets />}
    </div></SettingsGroup>)}
  </div>
}
