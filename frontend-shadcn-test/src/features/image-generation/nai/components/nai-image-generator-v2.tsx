import { useMemo } from 'react'
import { Alert, Box, Button, CircularProgress, Grid, LinearProgress, Paper, Typography } from '@mui/material'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import NAIAnlasDisplay from '@/bridges/image-generation/nai-anlas-display'
import NAIBasicSettings from '@/bridges/image-generation/nai-basic-settings'
import NAISamplingSettings from '@/bridges/image-generation/nai-sampling-settings'
import NAIOutputSettings from '@/bridges/image-generation/nai-output-settings'
import NAIGroupSelector from '@/bridges/image-generation/nai-group-selector'
import RepeatControls from '@/features/workflows/components/repeat-controls'
import { GenerationHistoryList } from '@/features/workflows/components/generation-history-list'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'
import { useNAIParams } from '../hooks/use-nai-params'
import { useNAIGroupSelection } from '../hooks/use-nai-group-selection'
import { useRepeatExecution } from '@/bridges/image-generation/use-repeat-execution'
import { useNAIGeneration } from '@/bridges/image-generation/use-nai-generation'
import { RESOLUTIONS } from '../constants/nai.constants'

interface NAIImageGeneratorV2Props {
  token: string
  onLogout: () => void
}

export default function NAIImageGeneratorV2({ token, onLogout }: NAIImageGeneratorV2Props) {
  const { t } = useTranslation(['imageGeneration'])
  const { params, setParams } = useNAIParams()
  const { selectedGroupId, selectedGroup, groupModalOpen, setGroupModalOpen, handleGroupSelect, handleRemoveGroup } = useNAIGroupSelection()

  const { generating, error, userData, historyRefreshKey, executeSingleGeneration, calculateCost } = useNAIGeneration({ token, onLogout })

  const { repeatConfig, repeatState, setRepeatConfig, startRepeat, stopRepeat, isRepeatMode } = useRepeatExecution({
    onExecute: async () => {
      await executeSingleGeneration(params, selectedGroupId)
    },
  })

  const costInfo = useMemo(() => {
    if (!userData) {
      return {
        minCost: 0,
        maxCost: 0,
        balance: 0,
        canGenerate: false,
        buttonText: '이미지생성',
      }
    }

    const config = params.resolutionConfig
    const selections = config.mode === 'fixed' ? [config.fixed] : config.random
    const resolutions = selections
      .map((key) => {
        if (key in RESOLUTIONS) {
          return RESOLUTIONS[key as keyof typeof RESOLUTIONS]
        }
        const custom = config.customResolutions.find((resolution) => `custom_${resolution.id}` === key)
        return custom ? { width: custom.width, height: custom.height } : null
      })
      .filter(Boolean) as Array<{ width: number; height: number }>
    if (resolutions.length === 0) {
      resolutions.push({ width: 832, height: 1216 })
    }

    const possibleResolutions =
      params.resolutionConfig.swapDimensions && params.resolutionConfig.mode === 'random'
        ? resolutions.flatMap((resolution) => [resolution, { width: resolution.height, height: resolution.width }])
        : params.resolutionConfig.swapDimensions
          ? resolutions.map((resolution) => ({ width: resolution.height, height: resolution.width }))
          : resolutions

    const costs = possibleResolutions.map((resolution) =>
      calculateCost({
        width: resolution.width,
        height: resolution.height,
        steps: params.steps,
        n_samples: params.n_samples,
        uncond_scale: params.uncond_scale,
      }),
    )

    const minCost = Math.min(...costs)
    const maxCost = Math.max(...costs)
    const balance = userData.anlasBalance
    const canGenerate = balance >= minCost

    let buttonText: string
    if (!canGenerate) {
      buttonText = '이미지생성 (잔액 부족)'
    } else if (minCost === maxCost) {
      buttonText = `이미지생성 (비용: ${minCost} / 잔액: ${balance.toLocaleString()})`
    } else {
      buttonText = `이미지생성 (비용: ${minCost}~${maxCost} / 잔액: ${balance.toLocaleString()})`
    }

    return { minCost, maxCost, balance, canGenerate, buttonText }
  }, [userData, params.resolutionConfig, params.steps, params.n_samples, params.uncond_scale, calculateCost])

  const handleGenerate = async (event?: React.FormEvent) => {
    if (event) {
      event.preventDefault()
    }

    if (isRepeatMode && !repeatState.isRunning) {
      startRepeat()
      return
    }

    if (!isRepeatMode) {
      await executeSingleGeneration(params, selectedGroupId)
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">{t('imageGeneration:nai.generate.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <NAIAnlasDisplay token={token} />
          <Button variant="outlined" onClick={onLogout}>
            {t('imageGeneration:nai.generate.logout')}
          </Button>
        </Box>
      </Box>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <form onSubmit={handleGenerate}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={generating || !params.prompt || (Boolean(userData) && !costInfo.canGenerate)}
                startIcon={generating ? <CircularProgress size={20} /> : <Sparkles className="h-4 w-4" />}
              >
                {costInfo.buttonText}
              </Button>

              <NAIBasicSettings params={params} onChange={setParams} disabled={generating} />
              <NAISamplingSettings params={params} onChange={setParams} disabled={generating} />
              <NAIOutputSettings params={params} onChange={setParams} disabled={generating} />

              <NAIGroupSelector
                selectedGroup={selectedGroup}
                onOpenModal={() => setGroupModalOpen(true)}
                onRemoveGroup={handleRemoveGroup}
                disabled={generating}
              />

              <Paper sx={{ p: 3 }}>
                <RepeatControls
                  config={repeatConfig}
                  state={repeatState}
                  onConfigChange={setRepeatConfig}
                  onStop={stopRepeat}
                  namespace="imageGeneration"
                />
              </Paper>

              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={generating || !params.prompt || (Boolean(userData) && !costInfo.canGenerate)}
                startIcon={generating ? <CircularProgress size={20} /> : <Sparkles className="h-4 w-4" />}
              >
                {generating ? '생성 중...' : costInfo.buttonText}
              </Button>
              {generating ? <LinearProgress sx={{ mt: 1 }} /> : null}
            </Box>
          </form>
        </Grid>

        <Grid size={{ xs: 12, lg: 8 }}>
          <GenerationHistoryList serviceType="novelai" refreshKey={historyRefreshKey} />
        </Grid>
      </Grid>

      <GroupAssignModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        selectedImageCount={1}
        onAssign={handleGroupSelect}
      />
    </Box>
  )
}
