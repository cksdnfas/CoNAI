import { Navigate, useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '@/components/common/segmented-control'
import { ChatLorebookEditorPage } from '@/features/settings/components/chat-lorebook-editor-page'
import { ChatProfileEditorPage } from '@/features/settings/components/chat-profile-editor'
import { ChatSettingsJudge } from '@/features/settings/components/chat-settings-judge'
import { ChatSettingsMine } from '@/features/settings/components/chat-settings-mine'
import { ChatSettingsProfiles } from '@/features/settings/components/chat-settings-profiles'
import { ChatSettingsResources } from '@/features/settings/components/chat-settings-resources'
import { registerTranslationCatalog, useI18n } from '@/i18n'
import { charactersCatalog } from '@/i18n/resources/characters'
import { settingsCatalog } from '@/i18n/resources/settings'
import { CHAT_WORKSPACE_PATHS, parseChatResourceTab, type ChatResourceTab } from './chat-admin-location'
import { ChatSettingsRoutines } from './chat-routines'

registerTranslationCatalog(settingsCatalog)
registerTranslationCatalog(charactersCatalog)

/** 프로필: the profile folders and cards, or one profile's editor page (?profile=<id|new>). */
export function ChatProfilesScreen() {
  const [params] = useSearchParams()
  return params.has('profile') ? <ChatProfileEditorPage /> : <ChatSettingsProfiles />
}

/** 자원: tool, generation and judge presets, display blocks and lorebooks (one kind at a time; ?tab=). A lorebook opens as its editor page. */
export function ChatResourcesScreen() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  // Routines were once a tab of this screen.
  if (params.get('tab') === 'routines') return <Navigate to={CHAT_WORKSPACE_PATHS.routines} replace />
  const tab = parseChatResourceTab(params.get('tab'))
  if (tab === 'lorebooks' && params.has('lorebook')) return <ChatLorebookEditorPage />
  const labels: Record<ChatResourceTab, string> = {
    presets: t({ ko: '프리셋', en: 'Presets' }),
    blocks: t({ ko: '표시 블록', en: 'Display blocks' }),
    lorebooks: t({ ko: '로어북', en: 'Lorebooks' }),
  }
  return (
    <div className="space-y-6 pt-3">
      <SegmentedControl
        semantics="tabs"
        size="sm"
        ariaLabel={t({ ko: '자원 종류', en: 'Resource kinds' })}
        value={tab}
        onChange={(value) => setParams({ tab: value })}
        items={(Object.keys(labels) as ChatResourceTab[]).map((value) => ({ value, label: labels[value] }))}
      />
      <ChatSettingsResources tab={tab} />
    </div>
  )
}

export function ChatRoutinesScreen() {
  return <div className="pt-3"><ChatSettingsRoutines /></div>
}

export function ChatJudgeScreen() {
  return <div className="pt-3"><ChatSettingsJudge /></div>
}

/** 내 설정: the account's own personas and flags (for everyone who can chat). */
export function ChatMineScreen() {
  return <div className="pt-3"><ChatSettingsMine /></div>
}
