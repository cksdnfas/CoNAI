import type { ComponentType } from 'react'
import { Clapperboard, Eye, FilePen, FolderKanban, Images, Pencil, ServerCog, Wrench } from 'lucide-react'
import type { PluginCapability } from '@conai/shared'
import { Chip } from '@/components/ui/chip'
import { ListRow } from '@/components/ui/list-row'
import { useI18n, type TranslationDictionary } from '@/i18n'

type CapabilityIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** What each plugin permission lets it do, in the words a person approves. */
export const PLUGIN_CAPABILITIES: Record<PluginCapability, { icon: CapabilityIcon; label: TranslationDictionary }> = {
  'files.read': { icon: Eye, label: { ko: '선택한 텍스트 파일 읽기', en: 'Read selected text files' } },
  'files.write': { icon: FilePen, label: { ko: '선택한 파일의 저장 제안', en: 'Propose changes to selected files' } },
  'files.media': { icon: Images, label: { ko: '선택한 미디어 보기', en: 'View selected media' } },
  'workspace.read': { icon: FolderKanban, label: { ko: '연결한 프로젝트 목록·문서 읽기', en: 'Read connected project folders and documents' } },
  'workspace.write': { icon: Pencil, label: { ko: '연결한 프로젝트 문서의 저장 제안', en: 'Propose project document saves' } },
  'workspace.media': { icon: Images, label: { ko: '프로젝트가 참조한 미디어 보기', en: 'View project media references' } },
  'media.process': { icon: Clapperboard, label: { ko: '검토 후 미디어 처리·파생 결과 저장', en: 'Process media and save derived results after review' } },
  server: { icon: ServerCog, label: { ko: '서버 코드 실행 · 앱 전체 권한', en: 'Runs server code · full app access' } },
}

/** A plugin's permissions as hairline rows (icon + what it may do), then the app features it may call. */
export function PluginCapabilityList({ capabilities, appTools = [] }: { capabilities: readonly PluginCapability[]; appTools?: readonly string[] }) {
  const { t } = useI18n()
  return (
    <div>
      {capabilities.map((capability) => {
        const entry = PLUGIN_CAPABILITIES[capability] ?? PLUGIN_CAPABILITIES['files.media']
        const Icon = entry.icon
        // Server code is trusted with everything: it reads in the warning colour wherever the list shows.
        const tone = capability === 'server' ? 'text-warning' : 'text-muted-foreground'
        return <ListRow key={capability} size="sm" leading={<Icon className={`size-4 ${tone}`} aria-hidden />}><span className={capability === 'server' ? 'font-semibold text-warning' : 'text-foreground'}>{t(entry.label)}</span></ListRow>
      })}
      {appTools.length ? (
        <ListRow size="sm" leading={<Wrench className="size-4 text-muted-foreground" aria-hidden />}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-foreground">{t({ ko: '앱 기능', en: 'App features' })}</span>
            {appTools.map((tool) => <Chip key={tool} size="sm" tone="muted" className="font-mono">{tool}</Chip>)}
          </span>
        </ListRow>
      ) : null}
    </div>
  )
}
