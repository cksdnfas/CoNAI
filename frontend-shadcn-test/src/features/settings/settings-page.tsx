import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSettings } from '@/hooks/use-settings'

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

export function SettingsPage() {
  const settingsQuery = useSettings()
  const settings = settingsQuery.data?.data

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings Snapshot</h1>
        <p className="text-sm text-muted-foreground">`/api/settings` 응답을 분리 프론트에서 조회/검증합니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>기존 프론트 주요 옵션의 읽기 검증</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-muted-foreground">language</p>
            <p className="font-medium">{settings?.general?.language ?? '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">enableGallery</p>
            <p className="font-medium">{String(settings?.general?.enableGallery ?? '-')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">autoCleanupCanvasOnShutdown</p>
            <p className="font-medium">{String(settings?.general?.autoCleanupCanvasOnShutdown ?? '-')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">showRatingBadges</p>
            <p className="font-medium">{String(settings?.general?.showRatingBadges ?? '-')}</p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Tabs defaultValue="general" className="space-y-3">
        <TabsList>
          <TabsTrigger value="general">general</TabsTrigger>
          <TabsTrigger value="full">full payload</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>general payload</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{pretty(settings?.general ?? {})}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="full">
          <Card>
            <CardHeader>
              <CardTitle>/api/settings payload</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{pretty(settings ?? {})}</pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
