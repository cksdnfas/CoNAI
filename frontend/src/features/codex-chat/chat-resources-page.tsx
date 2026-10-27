import { lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { RequireAuthPermission } from '@/features/auth/require-auth-permission'
import { ChatLorebookEditorPage } from '@/features/settings/components/chat-lorebook-editor-page'
import { ChatSettingsResources } from '@/features/settings/components/chat-settings-resources'
import { registerTranslationCatalog, useI18n } from '@/i18n'
import { settingsCatalog } from '@/i18n/resources/settings'

registerTranslationCatalog(settingsCatalog)
const Routines = lazy(() => import('./chat-routines').then((module) => ({ default: module.ChatSettingsRoutines })))

/** Resource editing retains the administrator gate of its previous Settings home. */
export function ChatResourcesPage() {
  return <RequireAuthPermission permissionKey="page.settings.view"><ChatResources /></RequireAuthPermission>
}

function ChatResources() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab = raw === 'blocks' || raw === 'lorebooks' || raw === 'routines' ? raw : 'presets'
  // An open lorebook (?lorebook=…) replaces the list with its editor page.
  if (tab === 'lorebooks' && params.has('lorebook')) return <ChatLorebookEditorPage />
  return <div className="space-y-6">
    <PageToolbar title={t({ ko: '채팅 자원', en: 'Chat resources' })} actions={<Button asChild variant="ghost"><Link to="/chat">{t({ ko: '채팅으로 돌아가기', en: 'Back to chat' })}</Link></Button>} />
    <TextTabs value={tab} onChange={(value) => setParams({ tab: value })} items={[
      { value: 'presets', label: t({ ko: '프리셋', en: 'Presets' }) },
      { value: 'blocks', label: t({ ko: '표시 블록', en: 'Display blocks' }) },
      { value: 'lorebooks', label: t({ ko: '로어북', en: 'Lorebooks' }) },
      { value: 'routines', label: t({ ko: '루틴', en: 'Routines' }) },
    ]} />
    {tab === 'routines' ? <Suspense fallback={null}><Routines /></Suspense> : <ChatSettingsResources tab={tab} />}
  </div>
}
