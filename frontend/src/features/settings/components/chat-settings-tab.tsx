import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { ChatSettingsMine } from './chat-settings-mine'
import { ChatSettingsProfiles } from './chat-settings-profiles'
import { ChatSettingsResources } from './chat-settings-resources'
import { SETTINGS_TEXT_TAB_LIST_CLASS, SETTINGS_TEXT_TAB_TRIGGER_CLASS } from './settings-text-tabs'
import { ChatSettingsRoutines } from '@/features/codex-chat/chat-routines'

type ChatSettingsView = 'profiles' | 'resources' | 'mine' | 'routines'

/** `?view=` of the chat tab (the page's own tab lives in `?section=`); no value means the profiles view. */
function parseView(raw: string | null): ChatSettingsView {
  return raw === 'resources' || raw === 'mine' || raw === 'routines' ? raw : 'profiles'
}

/** Settings › Chat: text tabs for the profiles, the shared resources, the account's own settings and the routines. */
export function ChatSettingsTab() {
  const { t } = useI18n()
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view')
  const view = parseView(rawView)

  // The judge log moved to Settings › LLM; old links land there.
  useEffect(() => {
    if (rawView !== 'judge') return
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      params.set('section', 'llm')
      return params
    }, { replace: true })
  }, [rawView, setSearchParams])

  const setView = (next: string) => {
    const target = parseView(next)
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (target === 'profiles') params.delete('view')
      else params.set('view', target)
      return params
    }, { replace: true })
  }

  return (
    <Tabs value={view} onValueChange={setView} className="gap-6">
      <TabsList className={SETTINGS_TEXT_TAB_LIST_CLASS}>
        <TabsTrigger value="profiles" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '프로필', en: 'Profiles' })}</TabsTrigger>
        <TabsTrigger value="resources" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '자원', en: 'Resources' })}</TabsTrigger>
        <TabsTrigger value="mine" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '내 설정', en: 'Mine' })}</TabsTrigger>
        {isAdmin ? <TabsTrigger value="routines" className={SETTINGS_TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '루틴', en: 'Routines' })}</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="profiles"><ChatSettingsProfiles /></TabsContent>
      <TabsContent value="resources"><ChatSettingsResources /></TabsContent>
      <TabsContent value="mine"><ChatSettingsMine /></TabsContent>
      {isAdmin ? <TabsContent value="routines"><ChatSettingsRoutines /></TabsContent> : null}
    </Tabs>
  )
}
