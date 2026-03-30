import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function LoginPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10">
      <div className="w-full space-y-8">
        <PageHeader
          eyebrow="Phase 1"
          title="로그인 준비 중"
        />

        <Card className="border-primary/15 bg-card">
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading="현재 상태"
            />

            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/12 p-3 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground">인증 복구 대기</div>
                <div className="text-sm text-muted-foreground">실제 로그인 폼은 아직 비활성화돼 있어.</div>
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
  )
}
