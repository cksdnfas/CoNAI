import { Button } from '@/components/ui/button'

interface NAIGroupSelectorProps {
  selectedGroup: { name?: string } | null
  onOpenModal: () => void
  onRemoveGroup: () => void
  disabled?: boolean
}

export default function NAIGroupSelector({ selectedGroup, onOpenModal, onRemoveGroup, disabled = false }: NAIGroupSelectorProps) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm">Group: {selectedGroup?.name || 'none selected'}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onOpenModal} disabled={disabled}>Select Group</Button>
        <Button type="button" variant="ghost" onClick={onRemoveGroup} disabled={disabled || !selectedGroup}>Clear</Button>
      </div>
    </div>
  )
}
