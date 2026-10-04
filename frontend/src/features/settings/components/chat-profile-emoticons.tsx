import { useQuery } from '@tanstack/react-query'
import { Smile } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import { getGroupsHierarchyAll } from '@/lib/api-groups'

/** Emoticon groups a profile's chats can use; the order picked is the priority when two share a keyword. */
export function ChatEmoticonGroupPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const { t } = useI18n()
  const groupsQuery = useQuery({ queryKey: ['groups-hierarchy-all', 'emoticon-picker'], queryFn: getGroupsHierarchyAll, staleTime: 30_000 })
  const groups = (groupsQuery.data ?? []).filter((group) => Boolean(group.emoticon_enabled))
  // A linked group that stopped being an emoticon group stays listed so it can be unlinked.
  const missing = selected.filter((id) => !groups.some((group) => group.id === id))

  if (groups.length === 0 && missing.length === 0) {
    return <p className="text-xs text-muted-foreground">{t({ ko: '이모티콘 그룹이 없어', en: 'No emoticon groups' })}</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((group) => {
        const index = selected.indexOf(group.id)
        const pressed = index >= 0
        return (
          <ToggleChip
            key={group.id}
            size="sm"
            pressed={pressed}
            onClick={() => onChange(pressed ? selected.filter((id) => id !== group.id) : [...selected, group.id])}
          >
            <Smile className="size-3.5" />
            {group.name}
            {pressed && selected.length > 1 ? <span className="tabular-nums opacity-70">{index + 1}</span> : null}
          </ToggleChip>
        )
      })}
      {missing.map((id) => (
        <ToggleChip key={id} size="sm" pressed onClick={() => onChange(selected.filter((entry) => entry !== id))}>
          #{id}
        </ToggleChip>
      ))}
    </div>
  )
}
