import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { ChatSettingsMine } from './chat-settings-mine'
import { ChatSettingsProfiles } from './chat-settings-profiles'
import { ChatSettingsResources } from './chat-settings-resources'

type ChatSettingsView = 'profiles' | 'resources' | 'mine'

/** `?view=` of the chat tab (the page's own tab lives in `?section=`); no value means the profiles view. */
function parseView(raw: string | null): ChatSettingsView {
  return raw === 'resources' || raw === 'mine' ? raw : 'profiles'
}

const TAB_LIST_CLASS = 'flex w-full flex-nowrap gap-5 rounded-none border-b border-line bg-transparent p-0'
const TAB_TRIGGER_CLASS = 'relative rounded-none px-0 pb-2 pt-0 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/** Settings › Chat: text tabs for the profiles, the shared resources and the account's own settings. */
export function ChatSettingsTab() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseView(searchParams.get('view'))

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
      <TabsList className={TAB_LIST_CLASS}>
        <TabsTrigger value="profiles" className={TAB_TRIGGER_CLASS}>{t({ ko: '프로필', en: 'Profiles' })}</TabsTrigger>
        <TabsTrigger value="resources" className={TAB_TRIGGER_CLASS}>{t({ ko: '자원', en: 'Resources' })}</TabsTrigger>
        <TabsTrigger value="mine" className={TAB_TRIGGER_CLASS}>{t({ ko: '내 설정', en: 'Mine' })}</TabsTrigger>
      </TabsList>
      <TabsContent value="profiles"><ChatSettingsProfiles /></TabsContent>
      <TabsContent value="resources"><ChatSettingsResources /></TabsContent>
      <TabsContent value="mine"><ChatSettingsMine /></TabsContent>
    </Tabs>
  )
}
