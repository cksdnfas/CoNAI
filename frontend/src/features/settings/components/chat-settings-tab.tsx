import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ChatMemorySettings, ChatToolSettings, ChatWebSettings, useChatOptions } from './chat-options-settings'
import { useChatOptionsPageParts } from './chat-options-page'
import { SettingsContents, SettingsGroup } from './settings-navigation'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { ChatFilledLabel } from './settings-filled-label'
import { ChatSettingsMine } from './chat-settings-mine'

/** Behaviour only: resources live in the character and chat workspaces. */
export function ChatSettingsTab() {
  const { t } = useI18n()
  const options = useChatOptionsPageParts('memory-web')
  const { settingsQuery, settingsMutation } = useChatOptions()
  const groups = [{ id: 'memory', label: t({ ko: '기억', en: 'Memory' }) }, { id: 'tools', label: t({ ko: '도구 사용', en: 'Tool use' }) }, { id: 'web', label: t({ ko: '웹 검색', en: 'Web search' }) }, { id: 'flags', label: t({ ko: '공용 플래그', en: 'Shared flags' }) }]
  return <div className="space-y-8">
    <SettingsContents groups={groups} />
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="ghost" size="sm"><Link to="/characters?view=profiles">{t({ ko: '채팅 프로필은 캐릭터 화면으로 옮겼어 → 열기', en: 'Chat profiles moved to Characters → Open' })}</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/chat/resources">{t({ ko: '채팅 자원 열기', en: 'Open chat resources' })}</Link></Button>
    </div>
    {settingsQuery.data ? <SettingsSwitchRow label={<ChatFilledLabel fieldId="chat.enabled" />} checked={settingsQuery.data.enabled} disabled={settingsMutation.isPending} onCheckedChange={(enabled) => settingsMutation.mutate({ enabled })} /> : null}
    <SettingsGroup id="memory" title={groups[0].label}><ChatMemorySettings /></SettingsGroup>
    <SettingsGroup id="tools" title={groups[1].label}><ChatToolSettings /></SettingsGroup>
    <SettingsGroup id="web" title={groups[2].label}><ChatWebSettings /></SettingsGroup>
    <ChatSettingsMine sharedFlags options={options} />
  </div>
}
