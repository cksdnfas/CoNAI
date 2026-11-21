import { CircleCheck, CircleDashed, CircleOff, Layers, Shapes, Tag } from 'lucide-react'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { REFMOD_CONCEPTS, refModConceptLabel, type RefModServerFilter } from '../refmod-shared'

/** The RefMod filters: where the bundle is (전체 / 있음 / 없음 / 미등록, matched against the default server) and the concept. */
export function RefModSidebar({ server, concept, total, unregisteredCount, onServer, onConcept }: {
  server: RefModServerFilter
  concept: string
  total: number | undefined
  unregisteredCount: number
  onServer: (server: RefModServerFilter) => void
  onConcept: (concept: string) => void
}) {
  const { t, formatNumber } = useI18n()
  const servers: Array<{ value: RefModServerFilter; label: string; icon: typeof Layers; count?: string }> = [
    { value: 'all', label: t({ ko: '전체', en: 'All' }), icon: Layers, count: total === undefined ? undefined : formatNumber(total) },
    { value: 'on', label: t({ ko: '서버에 있음', en: 'On the server' }), icon: CircleCheck },
    { value: 'off', label: t({ ko: '서버에 없음', en: 'Not on the server' }), icon: CircleOff },
    { value: 'unregistered', label: t({ ko: '미등록', en: 'Unregistered' }), icon: CircleDashed, count: unregisteredCount ? formatNumber(unregisteredCount) : undefined },
  ]
  return (
    <SidebarNav aria-label={t({ ko: 'RefMod 필터', en: 'RefMod filters' })}>
      <SidebarGroupLabel>{t({ ko: '서버', en: 'Server' })}</SidebarGroupLabel>
      {servers.map((item) => <SidebarItem key={item.value} icon={item.icon} label={item.label} count={item.count} active={server === item.value} aria-pressed={server === item.value} onClick={() => onServer(item.value)} />)}
      <SidebarGroupLabel>{t({ ko: '종류', en: 'Concept' })}</SidebarGroupLabel>
      <SidebarItem icon={Shapes} label={t({ ko: '전체', en: 'All' })} active={!concept} aria-pressed={!concept} onClick={() => onConcept('')} />
      {REFMOD_CONCEPTS.map((value) => <SidebarItem key={value} icon={Tag} label={refModConceptLabel(t, value)} active={concept === value} aria-pressed={concept === value} onClick={() => onConcept(concept === value ? '' : value)} />)}
    </SidebarNav>
  )
}
