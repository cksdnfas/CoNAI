import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function LoginPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10">
      <div className="w-full space-y-8">
        <PageHeader
          eyebrow="Phase 1"
          title="로그인 영역은 다음 단계에서 복구한다"
          description="지금은 인증 화면 자리를 먼저 확보한 상태야. 실제 계정 흐름은 앱 셸과 홈 MVP를 안정화한 뒤 연결할 거야."
        />

        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">현재 상태</h2>
            <p className="text-sm text-muted-foreground">인증 플로우는 보류 중이고, 이 화면은 진입 지점만 안정적으로 확보해 둔 상태야.</p>
          </div>

          <Card className="border-primary/15 bg-card">
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-primary/12 p-3 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">인증 복구 대기 상태</div>
                  <div className="text-sm text-muted-foreground">현재는 구조 우선 단계라 실제 로그인 폼은 아직 붙이지 않았다.</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Route reserved</Badge>
                <Badge variant="outline">Auth flow pending</Badge>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link to="/">홈으로 돌아가기</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
