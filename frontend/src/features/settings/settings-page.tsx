import { Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/common/page-header'

const nextWork = [
  'General / Account / Folders 최소 탭 구조 복구',
  '백엔드 설정 API 계약 연결',
  '폼 패턴과 저장 상태 UI 통일',
  '향후 확장 탭(생성/태거 관련) 분리 계획 정리',
]

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="설정 화면 자리 확보"
        description="설정은 범위가 넓으니까 지금은 위치만 고정하고, 실제 탭 복구는 후속 단계로 미룬다."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/12 p-3 text-primary">
              <Settings2 className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Settings baseline only</CardTitle>
              <CardDescription>구조 우선 단계라 세부 설정 폼은 아직 복구하지 않았다.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Route reserved</Badge>
            <Badge variant="outline">Tabs pending</Badge>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {nextWork.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
