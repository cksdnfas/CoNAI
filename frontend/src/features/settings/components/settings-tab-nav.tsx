import { Bot, Image, Library, MessageSquare, Server, SlidersHorizontal, Users, WandSparkles, Wrench, type LucideIcon } from 'lucide-react'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { type TranslationDictionary, useI18n } from '@/i18n'
import { SETTINGS_TAB_ITEMS, SETTINGS_TAB_LABELS, type SettingsTab, type SettingsTabGroup } from '../settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

const SETTINGS_TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  library: Library,
  media: Image,
  auto: Bot,
  generation: WandSparkles,
  chat: MessageSquare,
  accounts: Users,
  system: Server,
  maintenance: Wrench,
}

const SETTINGS_TAB_GROUP_LABELS: Record<SettingsTabGroup, TranslationDictionary> = {
  personalization: { ko: '기본', en: 'Basics' },
  library: { ko: '콘텐츠', en: 'Content' },
  services: { ko: '기능', en: 'Features' },
  administration: { ko: '관리', en: 'Administration' },
}

/** Settings sections as sidebar rows, grouped; the current section gets the fill + accent bar. Labels and rows stay
 * direct children of the nav so only the first group label drops its top padding. */
export function SettingsTabNav({ activeTab, onChange }: SettingsTabNavProps) {
  const { t } = useI18n()

  return (
    <SidebarNav aria-label={t({ ko: '설정 항목', en: 'Settings sections' })}>
      {(Object.keys(SETTINGS_TAB_GROUP_LABELS) as SettingsTabGroup[]).flatMap((group) => [
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
