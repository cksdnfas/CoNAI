import type { ReactNode } from 'react'
import type { PluginPackageReview } from '@conai/shared'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { useI18n } from '@/i18n'

type PackageSummary = Pick<PluginPackageReview, 'name' | 'version' | 'size' | 'updated' | 'enabled' | 'server' | 'files'>

export function PluginPackageReviewSummary({ review, metadata, children }: { review: PackageSummary; metadata?: ReactNode; children?: ReactNode }) {
  const { t } = useI18n()
  return <RowGroup heading={t({ ko: '설치 검토', en: 'Installation review' })}>
    <p className="py-2 text-sm">{review.name} · {review.version} · {review.size.toLocaleString()} bytes · {review.updated ? t({ ko: '업데이트 · 기존 데이터 유지', en: 'Update · keeps existing data' }) : t({ ko: '신규 설치 · 비활성 상태', en: 'New install · disabled' })}</p>
    {metadata}
    {review.server ? <p className="pb-2 text-sm text-warning">{t(review.enabled ? { ko: '켜진 플러그인의 업데이트야. 적용하면 서버 코드가 다시 실행돼.', en: 'This plugin is enabled. Applying the update restarts its server code.' } : { ko: '서버 모듈이 포함돼 있어. 활성화하면 서버에서 코드가 실행돼.', en: 'Contains a server module. Its code runs on the server when enabled.' })}</p> : null}
    <div className="max-h-36 overflow-y-auto">{review.files.filter(file => file.change !== 'unchanged').map(file => <ListRow key={file.name} size="sm"><span className="font-mono text-xs">{file.name}</span><span className="ml-auto text-xs">{t(file.change === 'added' ? { ko: '추가', en: 'Added' } : file.change === 'removed' ? { ko: '삭제', en: 'Removed' } : { ko: '수정', en: 'Changed' })}</span></ListRow>)}</div>
    {children}
  </RowGroup>
}
