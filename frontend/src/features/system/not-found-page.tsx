import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow="System"
          title="페이지를 찾지 못했어"
        />

        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">홈으로 돌아가.</div>
            <Button asChild>
              <Link to="/">홈으로 이동</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
