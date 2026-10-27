import { Bot, BrainCircuit, Image, Library, MessageSquare, Newspaper, Palette, Puzzle, Server, Users, Wand, Wrench, type LucideIcon } from 'lucide-react'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { type TranslationDictionary, useI18n } from '@/i18n'
import { SETTINGS_TAB_ITEMS, SETTINGS_TAB_LABELS, type SettingsTab, type SettingsTabGroup } from '../settings-tabs'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  mine: Users,
  general: Palette,
  library: Library,
  media: Image,
  auto: Bot,
  generation: Wand,
  chat: MessageSquare,
  posts: Newspaper,
  llm: BrainCircuit,
  accounts: Users,
  plugins: Puzzle,
  system: Server,
  maintenance: Wrench,
}

const SETTINGS_TAB_GROUP_LABELS: Record<SettingsTabGroup, TranslationDictionary> = {
  mine: { ko: '내 설정 (나에게만)', en: 'My settings (just me)' },
  shared: { ko: '앱 관리 (공용 · 관리자)', en: 'App management (shared · admin)' },
}

/** Settings sections as sidebar rows, grouped; the current section gets the fill + accent bar. Labels and rows stay
 * direct children of the nav so only the first group label drops its top padding. */
export function SettingsTabNav({ activeTab, onChange }: SettingsTabNavProps) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery().data

  return (
    <SidebarNav aria-label={t({ ko: '설정 항목', en: 'Settings sections' })}>
      {(Object.keys(SETTINGS_TAB_GROUP_LABELS) as SettingsTabGroup[]).filter((group) => group === 'mine' || auth?.isAdmin || !auth?.hasCredentials).flatMap((group) => [
        <SidebarGroupLabel key={`group-${group}`}>{t(SETTINGS_TAB_GROUP_LABELS[group])}</SidebarGroupLabel>,
        ...SETTINGS_TAB_ITEMS.filter((item) => item.group === group).map((item) => (
          <SidebarItem
            key={item.value}
            icon={SETTINGS_TAB_ICONS[item.value]}
            label={t(SETTINGS_TAB_LABELS[item.value])}
            active={activeTab === item.value}
            onClick={() => onChange(item.value)}
          />
        )),
      ])}
    </SidebarNav>
  )
}
