import { useNavigate } from 'react-router-dom'
import { RowGroup } from '@/components/ui/row-group'
import { useChatAdminLinks } from '@/features/codex-chat/chat-admin-location'
import { SettingsContents, SettingsGroup } from './settings-navigation'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { useI18n } from '@/i18n'
import { LlmConnectionsTab } from './llm-connections-tab'
import { LlmPromptPresets } from './llm-prompt-presets'
import { LlmUsageDashboard } from './llm-usage-dashboard'

/** Both AI connection hosts reuse the same editors and usage; workflow prompt presets stay in Settings. */
export function LlmSettingsTab() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const links = useChatAdminLinks()
  const dashboard = <LlmUsageDashboard onOpenJudge={() => navigate(links.judge())} />
  const groups = ['connections', 'dashboard', 'prompts'].map((id) => ({ id, label: t(SETTINGS_ROW_BY_ID[`llm.${id}`].label) }))
  // The chat host has no AI 프롬프트 group; the jump links and group ids still let a link or the assistant address the usage block.
  if (links.host === 'workspace') return <div className="space-y-8">
    <SettingsContents groups={groups.slice(0, 2)} />
    <div data-settings-group="connections" className="scroll-mt-36"><LlmConnectionsTab /></div>
    <div data-settings-group="dashboard" className="scroll-mt-36"><RowGroup heading={t({ ko: '사용량', en: 'Usage' })}>{dashboard}</RowGroup></div>
  </div>
  return <div className="space-y-8">
    <SettingsContents groups={groups} />
    {groups.map((group) => <SettingsGroup key={group.id} id={group.id} title={group.label}><div data-setting-id={`llm.${group.id}`}>
      {group.id === 'connections' ? <LlmConnectionsTab /> : group.id === 'dashboard' ? dashboard : <LlmPromptPresets />}
    </div></SettingsGroup>)}
  </div>
}
