import { useMemo } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import NAIAnlasDisplay from '@/features/image-generation/bridges/nai-anlas-display'
import NAIBasicSettings from '@/features/image-generation/bridges/nai-basic-settings'
import NAISamplingSettings from '@/features/image-generation/bridges/nai-sampling-settings'
import NAIOutputSettings from '@/features/image-generation/bridges/nai-output-settings'
import NAIGroupSelector from '@/features/image-generation/bridges/nai-group-selector'
import RepeatControls from '@/features/workflows/components/repeat-controls'
import { GenerationHistoryList } from '@/features/workflows/components/generation-history-list'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'
import { useNAIParams } from '../hooks/use-nai-params'
import { useNAIGroupSelection } from '../hooks/use-nai-group-selection'
import { useRepeatExecution } from '@/features/image-generation/bridges/use-repeat-execution'
import { useNAIGeneration } from '@/features/image-generation/bridges/use-nai-generation'
import { RESOLUTIONS } from '../constants/nai.constants'
import { ResponsiveGenerationShell } from '@/features/image-generation/components/responsive-generation-shell'

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('imageGeneration:nai.generate.title')}</h2>
        <div className="flex items-center gap-2">
          <NAIAnlasDisplay token={token} />
          <Button variant="outline" onClick={onLogout}>
            {t('imageGeneration:nai.generate.logout')}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Generation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ResponsiveGenerationShell
        mobileTriggerLabel={t('imageGeneration:page.mobileControllerOpen')}
        mobileControllerTitle={t('imageGeneration:page.mobileControllerTitle')}
        mobileControllerDescription=""
        controller={
          <form onSubmit={handleGenerate} className="space-y-4">
            <Button
              className="w-full"
              type="submit"
              size="lg"
              disabled={generating || !params.prompt || (Boolean(userData) && !costInfo.canGenerate)}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
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

            <Card className="py-0">
              <CardContent className="p-4">
                <RepeatControls
                  config={repeatConfig}
                  state={repeatState}
                  onConfigChange={setRepeatConfig}
                  onStop={stopRepeat}
                  namespace="imageGeneration"
                />
              </CardContent>
            </Card>

            <Button
              className="w-full"
              type="submit"
              size="lg"
              disabled={generating || !params.prompt || (Boolean(userData) && !costInfo.canGenerate)}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? '생성 중...' : costInfo.buttonText}
            </Button>

            {generating ? (
              <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
                <div className="bg-primary h-full w-1/3 animate-pulse" />
              </div>
            ) : null}
          </form>
        }
        history={<GenerationHistoryList serviceType="novelai" refreshKey={historyRefreshKey} />}
      />

      <GroupAssignModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        selectedImageCount={1}
        onAssign={handleGroupSelect}
      />
    </div>
  )
}
