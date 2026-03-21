import { UploadCloud } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/common/page-header'

const nextWork = [
  '드래그 앤 드롭 업로드 존 연결',
  '업로드 진행 상태 표시',
  '성공 후 홈 이미지 리스트 invalidate',
  '메타데이터/프롬프트 프리뷰 복구',
]

export function UploadPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Upload"
        title="업로드 화면 자리 확보"
        description="여긴 다음 MVP 단계에서 실제 업로드 흐름을 다시 연결할 자리야. 지금은 화면 경계와 우선순위만 고정해둔다."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-secondary/12 p-3 text-secondary">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Upload MVP pending</CardTitle>
              <CardDescription>홈/상세 MVP가 안정화되면 바로 여길 실제 기능으로 바꾼다.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Route reserved</Badge>
            <Badge variant="outline">UI placeholder</Badge>
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
