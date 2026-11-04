import { useSearchParams } from 'react-router-dom'
import { RowGroup } from '@/components/ui/row-group'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { CHAT_SETTINGS_GROUPS, CHAT_SETTINGS_OPTION_GROUPS, type ChatSettingsGroup } from '@/features/codex-chat/chat-admin-location'
import { ChatSettingsRoutines } from '@/features/codex-chat/chat-routines'
import { useI18n } from '@/i18n'
import { ChatLorebookEditorModal } from './chat-lorebook-editor-modal'
import { useChatOptionsPageRegistration } from './chat-options-page'
import { ChatDiagnosticsSettings, ChatMemorySettings, ChatToolSettings, ChatWebSettings, useChatOptions } from './chat-options-settings'
import { ChatProfileRouteModal } from './chat-profile-editor'
import { ChatProfilesCompact } from './chat-profiles-compact'
import { ChatSettingsJudge } from './chat-settings-judge'
import { ChatSettingsMine } from './chat-settings-mine'
import { ChatSettingsResources } from './chat-settings-resources'
import { ChatFilledLabel } from './settings-filled-label'
import { SettingsContents } from './settings-navigation'
import { SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › 채팅: everything the chat workspace manages, edited here without leaving Settings. The lists are the
 * workspace's own components; profiles and lorebooks open as modals over the lists (?profile=, ?lorebook=).
 */
export function ChatSettingsTab() {
  const [params] = useSearchParams()
  return <>
    <ChatSettingsGroups current={params.has('lorebook') ? 'lorebooks' : params.has('profile') ? 'profiles' : params.get('group') ?? CHAT_SETTINGS_GROUPS[0]} />
    {params.has('lorebook') ? <ChatLorebookEditorModal /> : params.has('profile') ? <ChatProfileRouteModal /> : null}
  </>
}

/** One scrolling page: all groups stay mounted, and only the addressed group's assistant adapter owns the page snapshot. */
function ChatSettingsGroups({ current }: { current: string }) {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions()
  useChatOptionsPageRegistration((CHAT_SETTINGS_OPTION_GROUPS as readonly string[]).includes(current))
  const labels: Record<ChatSettingsGroup, string> = {
    basic: t({ ko: '기본', en: 'Basics' }), memory: t({ ko: '기억', en: 'Memory' }), tools: t({ ko: '도구 사용', en: 'Tool use' }),
    web: t({ ko: '웹 검색', en: 'Web search' }), diagnostics: t({ ko: '진단', en: 'Diagnostics' }),
    profiles: t({ ko: '프로필', en: 'Profiles' }), presets: t({ ko: '프리셋', en: 'Presets' }), blocks: t({ ko: '표시 블록', en: 'Display blocks' }),
    lorebooks: t({ ko: '로어북', en: 'Lorebooks' }), routines: t({ ko: '루틴', en: 'Routines' }), judge: t({ ko: '판단 기록', en: 'Judge log' }),
    flags: t({ ko: '공용 플래그', en: 'Shared flags' }),
  }
  return <div className="space-y-8">
    <SettingsContents groups={CHAT_SETTINGS_GROUPS.map((id) => ({ id, label: labels[id] }))} />
    <RowGroup data-settings-group="basic" className="scroll-mt-36" heading={labels.basic}>
      {settingsQuery.data
        ? <SettingsSwitchRow label={<ChatFilledLabel fieldId="chat.enabled" />} checked={settingsQuery.data.enabled} disabled={settingsMutation.isPending} onCheckedChange={(enabled) => settingsMutation.mutate({ enabled })} />
        : settingsQuery.isError ? null : <SettingsRowsSkeleton rows={1} />}
    </RowGroup>
    <div data-settings-group="memory" className="scroll-mt-36"><ChatMemorySettings /></div>
    <div data-settings-group="tools" className="scroll-mt-36"><ChatToolSettings /></div>
    <div data-settings-group="web" className="scroll-mt-36"><ChatWebSettings /></div>
    <div data-settings-group="diagnostics" className="scroll-mt-36"><ChatDiagnosticsSettings /></div>
    <ChatProfilesCompact active={current === 'profiles'} />
    <ChatSettingsResources tab="all" active={current === 'presets' || current === 'blocks' || current === 'lorebooks'} />
    <ChatSettingsRoutines active={current === 'routines'} />
    <RowGroup data-setting-id="chat.judge" heading={labels.judge}><ChatSettingsJudge active={current === 'judge'} /></RowGroup>
    <ChatSettingsMine flagsOnly active={current === 'flags'} />
  </div>
}
