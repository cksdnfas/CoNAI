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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { findGroupById } from '@/features/prompt-explorer/utils'
import type { PromptGroupWithChildren } from '@/features/prompt-explorer/types'

interface CreateGroupDialogProps {
  open: boolean
  groups: PromptGroupWithChildren[]
  onClose: () => void
  onCreate: (name: string, parentId: number | null) => Promise<void>
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

export function CreateGroupDialog({ open, groups, onClose, onCreate }: CreateGroupDialogProps) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => flattenGroups(groups), [groups])
  const selectedParent = parentId === null ? null : findGroupById(groups, parentId)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Group name is required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onCreate(name.trim(), parentId)
      setName('')
      setParentId(null)
      onClose()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create group.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="prompt-group-name" className="text-sm font-medium">Group name</label>
            <Input
              id="prompt-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter group name"
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">Parent group (optional)</p>
            <button
              type="button"
              className={`w-full rounded border px-3 py-2 text-left text-sm ${parentId === null ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
              onClick={() => setParentId(null)}
            >
              Root level
            </button>
            <ScrollArea className="h-40 rounded border p-2">
              <div className="space-y-1">
                {options.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`w-full rounded px-2 py-1 text-left text-sm ${parentId === item.id ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
                    onClick={() => setParentId(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <p className="text-muted-foreground text-xs">
              {selectedParent ? `Selected parent: ${selectedParent.group_name}` : 'No parent selected.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving || !name.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
