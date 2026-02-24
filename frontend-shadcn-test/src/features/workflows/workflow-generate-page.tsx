import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useWorkflowData } from './hooks/use-workflow-data'
import { useServerManagement } from './hooks/use-server-management'
import { useGroupManagement } from './hooks/use-group-management'
import { useImageGeneration } from './hooks/use-image-generation'
import { useRepeatExecution } from './hooks/use-repeat-execution'
import { useServerRepeat } from './hooks/use-server-repeat'
import { GenerationHistoryList } from './components/generation-history-list'
import RepeatControls from './components/repeat-controls'
import { WorkflowHeader } from './components/workflow-header'
import { WorkflowFormFields } from './components/workflow-form-fields'
import { GroupAssignment } from './components/group-assignment'
import { RepeatExecutionStatus } from './components/repeat-execution-status'
import { ServerStatusList } from './components/server-status-list'
import type { PromptParseResult } from './types/prompt.types'

export function WorkflowGeneratePage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation(['workflows', 'common'])

  const { loading, error, setError, workflow, formData, loadWorkflow, handleFieldChange, getPromptData } = useWorkflowData(id)

  const [promptData, setPromptData] = useState<PromptParseResult>({
    data: {},
    emptyWildcards: [],
  })

  const { servers, serverStatus, generationStatus, setGenerationStatus, loadServers, getConnectedServers } = useServerManagement()

  const {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    loadSavedGroup,
    handleGroupSelect,
    handleRemoveGroup,
  } = useGroupManagement()

  const { historyRefreshKey, handleGenerateOnServer } = useImageGeneration({
    workflowId: id,
    workflow,
    formData,
    getPromptData,
    selectedGroupId,
    servers,
    setGenerationStatus,
    setError,
  })

  const [repeatConfig, setRepeatConfig] = useState({
    enabled: false,
    count: 3,
    delaySeconds: 5,
  })

  const { serverRepeatStates, handleStartServerRepeat, handleStopServerRepeat } = useServerRepeat({
    servers,
    repeatConfig,
    handleGenerateOnServer,
  })

  const { handleGenerateOnAllServers } = useRepeatExecution({
    servers,
    serverStatus,
    repeatConfig,
    handleGenerateOnServer,
    handleStartServerRepeat,
    setError,
  })

  useEffect(() => {
    loadWorkflow()
    loadServers()
    loadSavedGroup()
  }, [loadSavedGroup, loadServers, loadWorkflow])

  useEffect(() => {
    if (workflow && formData) {
      getPromptData()
        .then((data) => {
          setPromptData(data)
        })
        .catch((getPromptDataError) => {
          console.error('[WorkflowGeneratePage] Failed to build prompt data:', getPromptDataError)
          setPromptData({
            data: {},
            emptyWildcards: [],
          })
        })
    }
  }, [formData, getPromptData, workflow])

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="p-3">
        <Alert variant="destructive"><AlertDescription>{t('workflows:card.notFound')}</AlertDescription></Alert>
      </div>
    )
  }

  const connectedServers = getConnectedServers()

  return (
    <div className="space-y-3 p-3">
      <WorkflowHeader workflow={workflow} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-4">
          <WorkflowFormFields workflow={workflow} formData={formData} onFieldChange={handleFieldChange} promptData={promptData.data} />

          <GroupAssignment selectedGroup={selectedGroup} onOpenModal={() => setGroupModalOpen(true)} onRemove={handleRemoveGroup} />

          <Card className="p-3">
            <RepeatControls
              config={repeatConfig}
              state={{
                isRunning: Object.keys(serverRepeatStates).length > 0,
                currentIteration: 0,
                totalIterations: 0,
              }}
              onConfigChange={setRepeatConfig}
              onStop={() => {
                Object.keys(serverRepeatStates).forEach((serverId) => {
                  handleStopServerRepeat(Number(serverId))
                })
              }}
              namespace="workflows"
            />
          </Card>

          <Button
            className="w-full"
            size="lg"
            onClick={handleGenerateOnAllServers}
            disabled={connectedServers.length === 0 || !workflow.is_active || Object.keys(serverRepeatStates).length > 0}
          >
            <Play className="h-4 w-4" />
            {t('workflows:generate.generateAll', { count: connectedServers.length })}
          </Button>

          <RepeatExecutionStatus servers={servers} serverRepeatStates={serverRepeatStates} />

          <ServerStatusList
            workflow={workflow}
            servers={servers}
            serverStatus={serverStatus}
            generationStatus={generationStatus}
            serverRepeatStates={serverRepeatStates}
            onGenerate={handleGenerateOnServer}
            onStartRepeat={handleStartServerRepeat}
            onStopRepeat={handleStopServerRepeat}
          />

          {!workflow.is_active ? (
            <Alert>
              <AlertDescription>{t('workflows:alerts.inactiveWarning')}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="lg:col-span-8">
          <GenerationHistoryList serviceType="comfyui" workflowId={id ? Number(id) : 0} refreshKey={historyRefreshKey} />
        </div>
      </div>

      <GroupAssignModal open={groupModalOpen} onClose={() => setGroupModalOpen(false)} selectedImageCount={1} onAssign={handleGroupSelect} />
    </div>
  )
}
