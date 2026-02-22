import { useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Grid, Paper } from '@mui/material'
import { PlayArrow as PlayIcon } from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'
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
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  if (!workflow) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('workflows:card.notFound')}</Alert>
      </Box>
    )
  }

  const connectedServers = getConnectedServers()

  return (
    <Box sx={{ p: 3 }}>
      <WorkflowHeader workflow={workflow} />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <WorkflowFormFields workflow={workflow} formData={formData} onFieldChange={handleFieldChange} promptData={promptData.data} />

            <GroupAssignment selectedGroup={selectedGroup} onOpenModal={() => setGroupModalOpen(true)} onRemove={handleRemoveGroup} />

            <Paper sx={{ p: 3 }}>
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
                    handleStopServerRepeat(parseInt(serverId, 10))
                  })
                }}
                namespace="workflows"
              />
            </Paper>

            <Button
              fullWidth
              variant="contained"
              size="large"
              startIcon={<PlayIcon />}
              onClick={handleGenerateOnAllServers}
              disabled={connectedServers.length === 0 || !workflow.is_active || Object.keys(serverRepeatStates).length > 0}
            >
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

            {!workflow.is_active ? <Alert severity="warning">{t('workflows:alerts.inactiveWarning')}</Alert> : null}
          </Box>
        </Grid>

        <Grid size={{ xs: 12, md: 12, lg: 8 }}>
          <GenerationHistoryList serviceType="comfyui" workflowId={parseInt(id || '0', 10)} refreshKey={historyRefreshKey} />
        </Grid>
      </Grid>

      <GroupAssignModal open={groupModalOpen} onClose={() => setGroupModalOpen(false)} selectedImageCount={1} onAssign={handleGroupSelect} />
    </Box>
  )
}
