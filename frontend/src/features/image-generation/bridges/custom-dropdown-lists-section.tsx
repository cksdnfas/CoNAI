import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListPlus, Loader2, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { parseCustomDropdownItemsText } from '@/features/image-generation/utils/custom-dropdown-helpers'
import { customDropdownListApi, type CustomDropdownList } from '@/services/custom-dropdown-list-api'

interface ListCardProps {
  list: CustomDropdownList
  onDelete: (list: CustomDropdownList) => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response
    if (response?.data?.error) {
      return response.data.error
    }
    if (response?.data?.message) {
      return response.data.message
    }
  }

  return fallback
}

function ListCard({ list, onDelete }: ListCardProps) {
  return (
    <Card className={`h-full min-h-[140px] border-l-4 py-0 ${list.is_auto_collected ? 'border-l-blue-500' : 'border-l-emerald-500'}`}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold" title={list.name}>
            {list.name}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${list.name}`}
            onClick={() => onDelete(list)}
          >
            <Trash2 className="text-destructive h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <Badge variant={list.is_auto_collected ? 'default' : 'secondary'}>
            {list.is_auto_collected ? 'Auto' : 'Manual'}
          </Badge>
          <Badge variant="outline">{list.items.length} items</Badge>
        </div>

        {list.source_path ? (
          <p className="text-muted-foreground truncate text-[11px]" title={list.source_path}>
            {list.source_path}
          </p>
        ) : null}

        {list.description ? (
          <p className="text-muted-foreground line-clamp-2 text-xs" title={list.description}>
            {list.description}
          </p>
        ) : null}

        <div className="text-muted-foreground text-xs">{list.items.slice(0, 3).join(', ') || 'No items'}</div>
      </CardContent>
    </Card>
  )
}

export default function CustomDropdownListsSection() {
  const [lists, setLists] = useState<CustomDropdownList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'auto' | 'manual'>('auto')
  const [openDialog, setOpenDialog] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formItemsText, setFormItemsText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const autoLists = useMemo(() => lists.filter((list) => list.is_auto_collected), [lists])
  const manualLists = useMemo(() => lists.filter((list) => !list.is_auto_collected), [lists])

  const loadLists = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await customDropdownListApi.getAllLists()
      setLists(Array.isArray(response?.data) ? response.data : [])
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load custom dropdown lists.'))
      setLists([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  const closeDialog = () => {
    setOpenDialog(false)
    setFormName('')
    setFormDescription('')
    setFormItemsText('')
  }

  const handleCreate = async () => {
    const items = parseCustomDropdownItemsText(formItemsText)
    if (items.length === 0) {
      setError('Please add at least one dropdown item.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      await customDropdownListApi.createList({
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        items,
      })
      closeDialog()
      await loadLists()
      setTab('manual')
    } catch (createError) {
      setError(getErrorMessage(createError, 'Failed to create custom dropdown list.'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (list: CustomDropdownList) => {
    const confirmed = window.confirm(`Delete dropdown list \"${list.name}\"?`)
    if (!confirmed) {
      return
    }

    try {
      setError(null)
      await customDropdownListApi.deleteList(list.id)
      await loadLists()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Failed to delete custom dropdown list.'))
    }
  }

  const activeLists = tab === 'auto' ? autoLists : manualLists

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListPlus className="h-4 w-4" /> Custom Dropdown Lists
        </h2>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadLists()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => setOpenDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> Add List
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid="custom-dropdown-error">
          <AlertTitle>Custom dropdown error</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setError(null)}>
              Close
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(next) => setTab(next as 'auto' | 'manual')}>
        <TabsList>
          <TabsTrigger value="auto">Auto Collected ({autoLists.length})</TabsTrigger>
          <TabsTrigger value="manual">Manual ({manualLists.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="auto" className="mt-3">
          {loading ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading custom dropdown lists...</div>
          ) : activeLists.length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">No auto-collected custom dropdown lists found.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeLists.map((list) => (
                <ListCard key={list.id} list={list} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-3">
          {loading ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading custom dropdown lists...</div>
          ) : activeLists.length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">No manual custom dropdown lists found.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeLists.map((list) => (
                <ListCard key={list.id} list={list} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={openDialog} onOpenChange={(next) => (next ? setOpenDialog(true) : closeDialog())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create custom dropdown list</DialogTitle>
            <DialogDescription>Use one line per dropdown item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm">List name</p>
              <Input
                aria-label="List name"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="My list"
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm">Description</p>
              <Textarea
                aria-label="List description"
                rows={2}
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm">Items (one per line)</p>
              <Textarea
                aria-label="List items"
                rows={8}
                value={formItemsText}
                onChange={(event) => setFormItemsText(event.target.value)}
                placeholder={'model-a\nmodel-b\nmodel-c'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting || formName.trim().length === 0 || formItemsText.trim().length === 0}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
