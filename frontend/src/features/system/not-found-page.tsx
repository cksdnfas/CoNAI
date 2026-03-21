import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>페이지를 찾지 못했어</CardTitle>
          <CardDescription>라우트 맵에 아직 없는 경로거나 잘못 들어온 거야.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">홈으로 이동</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
