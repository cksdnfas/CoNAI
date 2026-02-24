import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { ComfyUIServer } from '@/services/comfyui-server-api'
import type { ServerRepeatState } from '../types/workflow.types'

interface RepeatExecutionStatusProps {
  servers: ComfyUIServer[]
  serverRepeatStates: Record<number, ServerRepeatState>
}

export function RepeatExecutionStatus({ servers, serverRepeatStates }: RepeatExecutionStatusProps) {
  const { t } = useTranslation(['workflows'])
  if (Object.keys(serverRepeatStates).length === 0) {
    return null
  }

  const completedTotal = Object.values(serverRepeatStates).reduce((sum, state) => sum + state.currentIteration, 0)
  const plannedTotal = Object.values(serverRepeatStates).reduce(
    (sum, state) => sum + (state.totalIterations === -1 ? 0 : state.totalIterations),
    0,
  )
  const hasInfinite = Object.values(serverRepeatStates).some((state) => state.totalIterations === -1)
  const progress = plannedTotal > 0 ? Math.min(100, (completedTotal / plannedTotal) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('workflows:repeatExecution.statusTitle')}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-3 pt-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t('workflows:repeatExecution.overall', {
              completed: completedTotal,
              total: plannedTotal > 0 ? ` / ${plannedTotal}` : '',
            })}
            {hasInfinite ? t('workflows:repeatExecution.withInfinite') : ''}
          </p>
          {plannedTotal > 0 ? (
            <div className="h-2 w-full rounded bg-muted">
              <div className="h-2 rounded bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {Object.entries(serverRepeatStates).map(([serverIdText, state]) => {
            const serverId = parseInt(serverIdText, 10)
            const server = servers.find((item) => item.id === serverId)
            if (!server) {
              return null
            }

            return (
              <div key={serverId} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
                <p className="flex-1 text-sm">{server.name}</p>
                <Badge variant={state.isRunning ? 'default' : 'secondary'}>
                  {state.totalIterations === -1
                    ? t('workflows:repeatExecution.serverProgressInfinite', { count: state.currentIteration })
                    : `${state.currentIteration} / ${t('workflows:repeatExecution.serverProgress', { count: state.totalIterations })}`}
                </Badge>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
