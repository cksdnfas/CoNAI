import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, GitBranch, Loader2, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { workflowApi, type Workflow } from '@/services/workflow-api'
import { comfyuiServerApi, type ComfyUIServer } from '@/services/comfyui-server-api'
import CustomDropdownListsSection from '@/features/image-generation/bridges/custom-dropdown-lists-section'

export default function ComfyUITab() {
  const { t } = useTranslation(['workflows', 'servers', 'common'])
  const navigate = useNavigate()

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowsLoading, setWorkflowsLoading] = useState(true)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)

  const [servers, setServers] = useState<ComfyUIServer[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [serversError, setServersError] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [editingServer, setEditingServer] = useState<ComfyUIServer | null>(null)
  const [testingServerId, setTestingServerId] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<number, boolean>>({})

  const [formData, setFormData] = useState({
    name: '',
    endpoint: '',
    description: '',
    is_active: true,
  })

  const loadWorkflows = useCallback(async () => {
    try {
      setWorkflowsLoading(true)
      const response = await workflowApi.getAllWorkflows()
      setWorkflows(response.data || [])
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setWorkflowsError(maybeError.message || 'Failed to load workflows')
    } finally {
      setWorkflowsLoading(false)
    }
  }, [])

  const handleDeleteWorkflow = async (id: number) => {
    if (!window.confirm(t('workflows:actions.confirmDelete'))) return

    try {
      await workflowApi.deleteWorkflow(id)
      await loadWorkflows()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setWorkflowsError(maybeError.message || 'Failed to delete workflow')
    }
  }

  const loadServers = useCallback(async () => {
    try {
      setServersLoading(true)
      const response = await comfyuiServerApi.getAllServers()
      setServers(response.data || [])
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to load servers')
    } finally {
      setServersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkflows()
    void loadServers()
  }, [loadServers, loadWorkflows])

  const handleOpenDialog = (server?: ComfyUIServer) => {
    if (server) {
      setEditingServer(server)
      setFormData({
        name: server.name,
        endpoint: server.endpoint,
        description: server.description || '',
        is_active: server.is_active,
      })
    } else {
      setEditingServer(null)
      setFormData({
        name: '',
        endpoint: 'http://127.0.0.1:8188',
        description: '',
        is_active: true,
      })
    }
    setOpenDialog(true)
  }

  const handleCloseDialog = () => {
    setOpenDialog(false)
    setEditingServer(null)
  }

  const handleSubmit = async () => {
    try {
      if (editingServer) {
        await comfyuiServerApi.updateServer(editingServer.id, formData)
      } else {
        await comfyuiServerApi.createServer(formData)
      }
      handleCloseDialog()
      await loadServers()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to save server')
    }
  }

  const handleDeleteServer = async (id: number) => {
    if (!window.confirm(t('servers:actions.confirmDelete'))) return

    try {
      await comfyuiServerApi.deleteServer(id)
      await loadServers()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to delete server')
    }
  }

  const handleTestConnection = async (id: number) => {
    setTestingServerId(id)
    try {
      const response = await comfyuiServerApi.testConnection(id)
      setConnectionStatus((previous) => ({
        ...previous,
        [id]: Boolean(response.data?.isConnected),
      }))
    } catch {
      setConnectionStatus((previous) => ({
        ...previous,
        [id]: false,
      }))
    } finally {
      setTestingServerId(null)
    }
  }

  const loading = workflowsLoading || serversLoading
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <GitBranch className="h-4 w-4" /> {t('workflows:page.listTitle')}
        </h2>

        {workflowsError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{workflowsError}</span>
              <Button variant="ghost" size="sm" onClick={() => setWorkflowsError(null)}>
                {t('common:actions.close')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {workflows.map((workflow) => (
            <Card
              key={workflow.id}
              className={`h-full min-h-[120px] border-l-4 py-0 transition ${workflow.is_active ? 'opacity-100 hover:-translate-y-0.5 hover:shadow-md' : 'opacity-60'}`}
              style={{ borderLeftColor: workflow.color || '#2196f3' }}
            >
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={workflow.is_active ? 'default' : 'outline'} className="h-5 text-[11px]">
                    {workflow.is_active ? t('workflows:card.active') : t('workflows:card.inactive')}
                  </Badge>
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => navigate(`/image-generation/${workflow.id}/edit`)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => void handleDeleteWorkflow(workflow.id)}>
                      <Trash2 className="text-destructive h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <p className="truncate text-[13px] font-semibold" title={workflow.name}>
                  {workflow.name}
                </p>

                {workflow.description ? (
                  <p
                    className="text-muted-foreground line-clamp-2 text-[11px]"
                    title={workflow.description}
                  >
                    {workflow.description}
                  </p>
                ) : null}

                <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-[11px]">
                  {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
                    <Badge variant="outline" className="h-[18px] text-[10px]">
                      {t('workflows:card.fieldsCount', { count: workflow.marked_fields.length })}
                    </Badge>
                  ) : null}
                  <span>{new Date(workflow.created_date).toLocaleDateString()}</span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  disabled={!workflow.is_active}
                  onClick={() => navigate(`/image-generation/${workflow.id}/generate`)}
                >
                  {t('workflows:actions.generate')}
                </Button>
              </CardContent>
            </Card>
          ))}

          <button
            type="button"
            onClick={() => navigate('/image-generation/new')}
            className="border-primary/40 bg-primary/5 hover:bg-primary/10 flex min-h-[120px] items-center justify-center rounded-xl border-2 border-dashed transition"
          >
            <span className="bg-primary text-primary-foreground inline-flex h-14 w-14 items-center justify-center rounded-full transition hover:rotate-90">
              <Plus className="h-7 w-7" />
            </span>
          </button>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Server className="h-4 w-4" /> {t('servers:page.listTitle')}
        </h2>

        {serversError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{serversError}</span>
              <Button variant="ghost" size="sm" onClick={() => setServersError(null)}>
                {t('common:actions.close')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {servers.map((server) => (
            <Card key={server.id} className="h-full min-h-[120px] border-l-4 border-l-green-500 py-0 transition hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={server.is_active ? 'default' : 'outline'} className="h-5 text-[11px]">
                    {server.is_active ? t('servers:card.active') : t('servers:card.inactive')}
                  </Badge>
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => handleOpenDialog(server)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => void handleDeleteServer(server.id)}>
                      <Trash2 className="text-destructive h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <p className="truncate text-[13px] font-semibold" title={server.name}>
                  {server.name}
                </p>

                <p className="text-muted-foreground truncate font-mono text-[11px]" title={server.endpoint}>
                  {server.endpoint}
                </p>

                {server.description ? (
                  <p className="text-muted-foreground line-clamp-2 text-[11px]" title={server.description}>
                    {server.description}
                  </p>
                ) : null}

                {connectionStatus[server.id] !== undefined ? (
                  <div className="flex items-center gap-1 text-[11px]">
                    {connectionStatus[server.id] ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        <span className="text-green-600">{t('servers:card.connectionSuccess')}</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                        <span className="text-red-600">{t('servers:card.connectionFailed')}</span>
                      </>
                    )}
                  </div>
                ) : null}

                <Button
                  size="sm"
                  onClick={() => void handleTestConnection(server.id)}
                  disabled={testingServerId === server.id}
                  className="mt-auto w-full text-xs"
                >
                  {testingServerId === server.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('servers:card.testConnection')}
                </Button>
              </CardContent>
            </Card>
          ))}

          <button
            type="button"
            onClick={() => handleOpenDialog()}
            className="border-green-500/40 bg-green-500/5 hover:bg-green-500/10 flex min-h-[120px] items-center justify-center rounded-xl border-2 border-dashed transition"
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white transition hover:rotate-90">
              <Plus className="h-7 w-7" />
            </span>
          </button>
        </div>
      </section>

      <Dialog open={openDialog} onOpenChange={(open) => (open ? setOpenDialog(true) : handleCloseDialog())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingServer ? t('servers:dialog.editTitle') : t('servers:dialog.addTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">{t('servers:dialog.serverName')}</p>
              <Input
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm">{t('servers:dialog.endpointUrl')}</p>
              <Input
                value={formData.endpoint}
                onChange={(event) => setFormData({ ...formData, endpoint: event.target.value })}
                placeholder={t('servers:dialog.endpointPlaceholder')}
                required
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm">{t('servers:dialog.description')}</p>
              <Textarea
                rows={2}
                value={formData.description}
                onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              />
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: Boolean(checked) })}
              />
              <span>{t('servers:dialog.activate')}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              {t('servers:dialog.cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!formData.name || !formData.endpoint}>
              {editingServer ? t('servers:dialog.update') : t('servers:dialog.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />
      <CustomDropdownListsSection />
    </div>
  )
}
