import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PromptGroupWithChildren } from '@/features/prompt-explorer/types'

interface MovePromptsDialogProps {
  open: boolean
  selectedCount: number
  groups: PromptGroupWithChildren[]
  onClose: () => void
  onConfirm: (groupId: number | null) => Promise<void>
}

interface FlatGroupItem {
  id: number
  label: string
}

function flattenGroups(nodes: PromptGroupWithChildren[], level = 0): FlatGroupItem[] {
  const items: FlatGroupItem[] = []
  for (const node of nodes) {
    items.push({ id: node.id, label: `${'  '.repeat(level)}${node.group_name}` })
    if (node.children.length > 0) {
      items.push(...flattenGroups(node.children, level + 1))
    }
  }
  return items
}

export function MovePromptsDialog({
  open,
  selectedCount,
  groups,
  onClose,
  onConfirm,
}: MovePromptsDialogProps) {
  const [targetGroupId, setTargetGroupId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => flattenGroups(groups), [groups])

  const handleConfirm = async () => {
    setSaving(true)
    setError(null)
    try {
      await onConfirm(targetGroupId)
      onClose()
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Failed to move prompts.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {selectedCount} prompt{selectedCount > 1 ? 's' : ''}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <button
            type="button"
            className={`w-full rounded border px-3 py-2 text-left text-sm ${targetGroupId === null ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
            onClick={() => setTargetGroupId(null)}
          >
            Root level
          </button>

          <ScrollArea className="h-52 rounded border p-2">
            <div className="space-y-1">
              {options.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left text-sm ${targetGroupId === item.id ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
                  onClick={() => setTargetGroupId(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={saving}>
            {saving ? 'Moving...' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
