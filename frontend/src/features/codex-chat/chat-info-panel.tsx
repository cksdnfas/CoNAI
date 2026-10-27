import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { getThreadLorebooks, threadLorebooksQueryKey, type ChatProfileSummary } from '@/lib/api-codex-chat'
import { ChatAppearancePopover } from './chat-appearance'
import { useChatPage } from './chat-page-context'
import { ChatProfileAvatar } from './chat-profile-avatar'

/** A row's end: a worded key that opens or changes what the row names. */
function RowKey({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <Button variant="link" size="xs" onClick={onClick}>{children}</Button>
}

/** A row's end that goes to another screen. */
function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return <Button asChild variant="link" size="xs"><Link to={to}>{children}</Link></Button>
}

/** A row whose value may run long: the label keeps its width and the value is cut at the row's end. */
function ValueRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <ListRow size="sm"><span className="shrink-0">{label}</span><span className="ml-auto min-w-0 truncate text-right text-muted-foreground">{children}</span></ListRow>
}

export type ChatInfoPanelProps = {
  threadId: number
  /** The chat's profile (a room's representative). */
  profile: ChatProfileSummary | null
  /** Rooms: every member; empty in a 1:1 chat. */
  members: ChatProfileSummary[]
  /** Kept summaries; null for Codex chats, which compact their own memory. */
  summaryCount: number | null
  /** Administrators open the profile editor from here. */
  canEditProfiles: boolean
  /** Whether the status panel is open; null when this chat has none to show. */
  statusOpen: boolean | null
  onToggleStatus: () => void
  onContext: () => void
  onGallery: () => void
  onExport: () => void
  layout: 'page' | 'panel'
}

/**
 * The open chat in one place: who it is with (the profile and the library look it shares, or a room's members), the
 * model and its context, what it remembers, whether it sees the page, and its views (status panel, look, images,
 * export). The wide chat page docks it beside the transcript; the panel and narrow pages show it as a sheet.
 */
export function ChatInfoPanelBody({ threadId, profile, members, summaryCount, canEditProfiles, statusOpen, onToggleStatus, onContext, onGallery, onExport, layout }: ChatInfoPanelProps) {
  const { t, formatNumber } = useI18n()
  const page = useChatPage()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const lore = useQuery({ queryKey: threadLorebooksQueryKey(threadId), queryFn: () => getThreadLorebooks(threadId), staleTime: 30_000 })
  const books = lore.data ? [...(lore.data.chatBook ? [lore.data.chatBook] : []), ...lore.data.books] : null
  const entryCount = books?.reduce((total, book) => total + book.entries.length, 0) ?? 0
  const isRoom = members.length > 0
  const link = isRoom ? null : profile?.characterLink
  const openProfile = (id: number) => canEditProfiles ? <RowLink to={`/characters?view=profiles&profile=${id}`}>{t({ ko: '프로필 열기', en: 'Open profile' })}</RowLink> : null
  const face = (entry: ChatProfileSummary) => <ChatProfileAvatar name={entry.name} avatar={entry.avatar} profile={entry} engine={entry.engine} size="sm" />

  return (
    <div className="space-y-5">
      {isRoom ? (
        <RowGroup heading={t({ ko: '참가자', en: 'Members' })} count={members.length}>
          {members.map((member) => <ListRow key={member.id} size="sm" leading={face(member)} trailing={openProfile(member.id)}><span className="truncate">{member.name}</span></ListRow>)}
        </RowGroup>
      ) : profile ? (
        <RowGroup heading={t({ ko: '프로필', en: 'Profile' })}>
          <ListRow size="sm" leading={face(profile)} trailing={openProfile(profile.id)}><span className="truncate font-medium">{profile.name}</span></ListRow>
          {link ? (
            <ValueRow label={t({ ko: '외형', en: 'Look' })}>
              <Link to={`/characters?setting=${link.settingId}`} title={[...link.path, link.settingName].join(' › ')} className="hover:text-foreground hover:underline">
                {[...link.path, link.settingName].join(' › ')}{link.synced ? '' : t({ ko: ' · 분리됨', en: ' · detached' })}
              </Link>
            </ValueRow>
          ) : null}
        </RowGroup>
      ) : null}
      <RowGroup heading={t({ ko: '모델', en: 'Model' })}>
        {!isRoom && profile?.modelLabel ? <ValueRow label={t({ ko: '모델', en: 'Model' })}><span title={profile.modelLabel}>{profile.modelLabel}</span></ValueRow> : null}
        <ListRow size="sm" trailing={<RowKey onClick={onContext}>{t({ ko: '자세히', en: 'Details' })}</RowKey>}>{t({ ko: '컨텍스트', en: 'Context' })}</ListRow>
      </RowGroup>
      <RowGroup heading={t({ ko: '기억', en: 'Memory' })}>
        {summaryCount !== null ? (
          <ValueRow label={t({ ko: '대화 요약', en: 'Summaries' })}>
            {summaryCount > 0 ? t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(summaryCount) }) : t({ ko: '없음', en: 'None' })}
          </ValueRow>
        ) : null}
        <ValueRow label={t({ ko: '로어북', en: 'Lorebooks' })}>
          {books ? books.length > 0 ? t({ ko: '{books}권 · 항목 {entries}개', en: '{books} books · {entries} entries' }, { books: formatNumber(books.length), entries: formatNumber(entryCount) }) : t({ ko: '없음', en: 'None' }) : null}
        </ValueRow>
      </RowGroup>
      {!isRoom && profile?.pageAssist && page?.available ? (
        <RowGroup heading={t({ ko: '연결', en: 'Connection' })}>
          <ListRow size="sm" trailing={<Switch size="sm" checked={page.enabled} onCheckedChange={page.toggle} aria-label={t({ ko: '페이지 연결', en: 'Page link' })} />}>{t({ ko: '페이지 연결', en: 'Page link' })}</ListRow>
        </RowGroup>
      ) : null}
      <RowGroup heading={t({ ko: '보기와 보관', en: 'Views and export' })}>
        {statusOpen !== null ? <ListRow size="sm" trailing={<RowKey onClick={onToggleStatus}>{statusOpen ? t({ ko: '닫기', en: 'Close' }) : t({ ko: '열기', en: 'Open' })}</RowKey>}>{t({ ko: '상태창', en: 'Status panel' })}</ListRow> : null}
        <ListRow size="sm" trailing={(
          // Opened to the key's left, over the transcript, rather than over the panel's own rows.
          <ChatAppearancePopover threadId={threadId} style={profile?.style} layout={layout} side="left" open={appearanceOpen} onOpenChange={setAppearanceOpen}>
            <span className="inline-flex"><RowKey onClick={() => setAppearanceOpen(true)}>{t({ ko: '바꾸기', en: 'Change' })}</RowKey></span>
          </ChatAppearancePopover>
        )}>{t({ ko: '채팅 모양', en: 'Chat appearance' })}</ListRow>
        <ListRow size="sm" trailing={<RowKey onClick={onGallery}>{t({ ko: '열기', en: 'Open' })}</RowKey>}>{t({ ko: '이미지 모아보기', en: 'Image gallery' })}</ListRow>
        <ListRow size="sm" trailing={<RowKey onClick={onExport}>{t({ ko: '파일로 저장', en: 'Save as file' })}</RowKey>}>{t({ ko: '내보내기', en: 'Export' })}</ListRow>
      </RowGroup>
    </div>
  )
}
