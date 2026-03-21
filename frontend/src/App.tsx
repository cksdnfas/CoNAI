import { ArrowRight, Compass, Layers3, Palette, ShieldCheck, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const rebuildOrder = [
  '인증과 앱 셸 정의',
  '홈 / 이미지 리스트 MVP',
  '이미지 상세와 업로드 복구',
  '그룹 / 설정 분리 재구축',
  '생성 / 워크플로우는 별도 단계로 확장',
]

const guardrails = [
  '색상은 primary/secondary 두 개만 사용',
  '컴포넌트는 재사용 가능한 토큰 중심으로 제작',
  '백엔드 계약은 우선 유지하고 화면 구조부터 재설계',
  '복잡한 생성/워크플로우 영역은 후순위로 분리',
]

const preservedContracts = [
  'Vite + React + TypeScript + Tailwind 4',
  '백엔드 프록시: /api, /uploads, /temp → :1666',
  '워크스페이스 구조: frontend / backend / shared',
  '디자인 토큰: primary #2563EB / secondary #14B8A6',
]

function SectionList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
          <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-border bg-card/90 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="border-primary/20 bg-primary/10 text-primary">Frontend Reset</Badge>
            <Badge className="border-secondary/25 bg-secondary/10 text-secondary">Blank-slate baseline</Badge>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                CoNAI 새 프론트 제작 준비 완료
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                  기존 프론트는 봉인했고,
                  <br />
                  이제 여기서부터 새로 만든다.
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
                  이 베이스라인은 기능 구현보다 먼저 <strong className="text-foreground">정보구조, 토큰, 컴포넌트 규칙</strong>을
                  고정하기 위한 출발점이다. 즉흥적으로 덧붙이지 말고, 제품 구조부터 다시 잡는다.
                </p>
              </div>
            </div>

            <Card className="border-primary/15 bg-linear-to-br from-primary/8 via-card to-secondary/8">
              <CardHeader>
                <CardTitle>현재 기준</CardTitle>
                <CardDescription>새 프론트의 기본 설계 계약</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/80 px-4 py-3">
                  <span>Primary</span>
                  <strong className="text-foreground">#2563EB</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/80 px-4 py-3">
                  <span>Secondary</span>
                  <strong className="text-foreground">#14B8A6</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/80 px-4 py-3">
                  <span>Frontend port</span>
                  <strong className="text-foreground">1677</strong>
                </div>
              </CardContent>
            </Card>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Compass className="h-5 w-5 text-primary" /> 재구축 순서</CardTitle>
              <CardDescription>낮은 복잡도부터 다시 세운다.</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionList items={rebuildOrder} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 설계 가드레일</CardTitle>
              <CardDescription>다시 커지기 전에 규칙부터 잠근다.</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionList items={guardrails} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" /> 유지된 계약</CardTitle>
              <CardDescription>리셋해도 끊지 않은 연결점들.</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionList items={preservedContracts} />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5 text-primary" /> 디자인 베이스라인</CardTitle>
              <CardDescription>
                Clean, modern operator dashboard with crisp typography, disciplined spacing, reusable components, and restrained accent usage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>Primary usage</span>
                    <span className="font-medium text-foreground">CTA / active / emphasis</span>
                  </div>
                  <div className="h-16 rounded-xl bg-primary" />
                </div>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>Secondary usage</span>
                    <span className="font-medium text-foreground">support / info / subtle accent</span>
                  </div>
                  <div className="h-16 rounded-xl bg-secondary" />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button size="lg">새 프론트 설계 시작</Button>
                <Button size="lg" variant="secondary">IA / 라우트 먼저 정의</Button>
                <Button size="lg" variant="outline">컴포넌트 규칙 정리</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>다음 액션</CardTitle>
              <CardDescription>이제 바로 이어서 할 일</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="font-medium text-foreground">1. 제품 우선순위 확정</p>
                <p className="mt-1">홈/상세/업로드를 먼저 살릴지, 생성/워크플로우까지 한 번에 가져갈지 결정.</p>
              </div>
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="font-medium text-foreground">2. 앱 셸과 라우트 맵 설계</p>
                <p className="mt-1">화면부터 그리지 말고, 정보구조와 전환 흐름을 먼저 고정.</p>
              </div>
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="font-medium text-foreground">3. 공통 컴포넌트 세트 정의</p>
                <p className="mt-1">button / card / input / nav / section layout를 먼저 통일.</p>
              </div>

              <Button className="w-full justify-between" variant="outline">
                현재는 준비 완료 상태
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
