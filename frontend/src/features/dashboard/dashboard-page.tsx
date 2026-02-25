import { Activity, Database, FolderOpen, ImageIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useBackendHealth } from '@/hooks/use-backend-health'
import { useImages } from '@/hooks/use-images'
import { useSettings } from '@/hooks/use-settings'

const formatUptime = (uptimeSec: number | undefined) => {
  if (!uptimeSec) return '-'
  const hours = Math.floor(uptimeSec / 3600)
  const minutes = Math.floor((uptimeSec % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export function DashboardPage() {
  const healthQuery = useBackendHealth()
  const settingsQuery = useSettings()
  const imagesQuery = useImages(1)

  const cards = [
    {
      title: 'Backend Status',
      value: healthQuery.data?.status ?? 'Unknown',
      desc: `Uptime: ${formatUptime(healthQuery.data?.uptime)}`,
      icon: Activity,
    },
    {
      title: 'Image DB (sample)',
      value: String(imagesQuery.data?.data.total ?? '-'),
      desc: 'GET /api/images total',
      icon: ImageIcon,
    },
    {
      title: 'Language',
      value: settingsQuery.data?.data.general?.language ?? '-',
      desc: 'GET /api/settings.general.language',
      icon: Database,
    },
    {
      title: 'Gallery Enabled',
      value: String(settingsQuery.data?.data.general?.enableGallery ?? '-'),
      desc: 'Settings flag snapshot',
      icon: FolderOpen,
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          기존 백엔드(`:1666`) 연동 상태를 점검하기 위한 shadcn/ui 테스트 대시보드입니다.
        </p>
      </div>

      {healthQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Backend connection failed</AlertTitle>
          <AlertDescription>
            /health 요청 실패: {healthQuery.error instanceof Error ? healthQuery.error.message : 'unknown error'}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {healthQuery.isLoading || settingsQuery.isLoading || imagesQuery.isLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <div className="text-2xl font-semibold">{card.value}</div>
              )}
              <CardDescription>{card.desc}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Route coverage (test frontend scope)</CardTitle>
          <CardDescription>기존 프론트의 다중 기능 구조를 분리 프론트에서 테스트 가능한 형태로 재현했습니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge>Dashboard</Badge>
          <Badge variant="secondary">Images</Badge>
          <Badge variant="secondary">Settings</Badge>
          <Badge variant="secondary">API Playground</Badge>
        </CardContent>
      </Card>
    </div>
  )
}
