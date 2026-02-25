import { CheckCircle2, CircleX, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { Workflow } from '@/services/workflow-api'
import type { ComfyUIServer } from '@/services/comfyui-server-api'
import type { ServerConnectionStatus, ServerGenerationStatus, ServerRepeatState } from '../types/workflow.types'

interface ServerStatusListProps {
  workflow: Workflow
  servers: ComfyUIServer[]
  serverStatus: Record<number, ServerConnectionStatus>
  generationStatus: Record<number, ServerGenerationStatus>
  serverRepeatStates: Record<number, ServerRepeatState>
  onGenerate: (serverId: number) => void
  onStartRepeat: (serverId: number) => void
  onStopRepeat: (serverId: number) => void
}

export function ServerStatusList({
  workflow,
  servers,
  serverStatus,
  generationStatus,
  serverRepeatStates,
  onGenerate,
  onStartRepeat,
  onStopRepeat,
}: ServerStatusListProps) {
  const { t } = useTranslation(['workflows'])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('workflows:generate.serversListTitle')}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-2 pt-4">
        {servers.length === 0 ? <Alert><AlertDescription>{t('workflows:generate.noServers')}</AlertDescription></Alert> : null}

        {servers.map((server) => {
          const status = serverStatus[server.id]
          const generation = generationStatus[server.id]
          const repeatState = serverRepeatStates[server.id]

          return (
            <div key={server.id} className="space-y-2 border-b pb-2 last:border-b-0">
              <div className="flex items-center gap-2">
                {status?.connected ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <CircleX className="h-4 w-4 text-rose-500" />
                )}
                <p className="flex-1 text-sm font-semibold">{server.name}</p>
                {generation?.status === 'generating' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              </div>

              {status?.responseTime ? (
                <p className="text-xs text-muted-foreground">{t('workflows:generate.responseTime', { time: status.responseTime })}</p>
              ) : null}

              {repeatState ? (
                <Badge>
                  {repeatState.totalIterations === -1
                    ? t('workflows:serverStatus.executingInfinite', { count: repeatState.currentIteration })
                    : t('workflows:serverStatus.executingProgress', {
                        current: repeatState.currentIteration,
                        total: repeatState.totalIterations,
                      })}
                </Badge>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onGenerate(server.id)}
                  disabled={!status?.connected || generation?.status === 'generating' || repeatState?.isRunning || !workflow.is_active}
                >
                  {t('workflows:serverStatus.generate')}
                </Button>
                {!repeatState?.isRunning ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onStartRepeat(server.id)}
                    disabled={!status?.connected || generation?.status === 'generating' || !workflow.is_active}
                  >
                    {t('workflows:serverStatus.startRepeat')}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => onStopRepeat(server.id)}>
                    {t('workflows:serverStatus.stop')}
                  </Button>
                )}
              </div>

              {generation?.status === 'generating' ? (
                <div className="h-1.5 w-full rounded bg-muted"><div className="h-1.5 w-1/2 animate-pulse rounded bg-primary" /></div>
              ) : null}

              {generation?.status === 'failed' ? (
                <Alert variant="destructive"><AlertDescription>{generation.error || t('workflows:generate.generationFailed')}</AlertDescription></Alert>
              ) : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
