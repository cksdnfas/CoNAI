import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { listAudioGroups, listAudioProjects } from '@/lib/api-audio'
import { getGraphWorkflowSchedules } from '@/lib/api-module-graph'
import {
  InspectorColor,
  InspectorHeading,
  InspectorRow,
  InspectorSegments,
  InspectorSlider,
} from './wallpaper-inspector-controls'
import { SwitchLine } from '@/components/ui/switch-line'
import {
  WallpaperPreviewCloseAnimationEditorField,
  WallpaperPreviewOpenAnimationEditorField,
  WallpaperInspectorDisclosure,
  type WallpaperWidgetSettingsPatchUpdater,
} from './wallpaper-widget-inspector-editor-shared'
import { WallpaperImageWidgetEditorFields } from './wallpaper-widget-inspector-image-editor-fields'
import { WallpaperStatusWidgetEditorFields } from './wallpaper-widget-inspector-status-editor-fields'
import { normalizeWallpaperClockStyle } from './wallpaper-clock-widget-body'
import { isWallpaperGroupSourceWidget, isWallpaperPreviewableImageWidget, type WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperChatProfiles } from './wallpaper-widget-data'

export interface WallpaperInspectorGroupOption {
  id: number
  name: string
  depth?: number | null
}

interface WallpaperWidgetTypeEditorFieldsProps {
  selectedWidget: WallpaperWidgetInstance
  groups: WallpaperInspectorGroupOption[]
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}

const DAY_OPTIONS = [1, 7, 14, 30, 90]

function ServiceSelect({ value, onChange }: { value: string; onChange: (value: 'all' | 'novelai' | 'comfyui' | 'codex') => void }) {
  const { t } = useI18n()
  return (
    <Select value={value} onChange={(event) => {
      const next = event.target.value
      onChange(next === 'novelai' || next === 'comfyui' || next === 'codex' ? next : 'all')
    }}>
      <option value="all">{t({ ko: '전체', en: 'All' })}</option>
      <option value="novelai">NovelAI</option>
      <option value="comfyui">ComfyUI</option>
      <option value="codex">Codex</option>
    </Select>
  )
}

function DaysSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <Select value={String(value)} onChange={(event) => onChange(Number(event.target.value))}>
      {DAY_OPTIONS.map((days) => (
        <option key={days} value={days}>{days === 1 ? t({ ko: '오늘', en: 'Today' }) : t({ ko: '{days}일', en: '{days} days' }, { days })}</option>
      ))}
    </Select>
  )
}

function CharacterSelect({ value, allowLatest, emptyLabel, onChange }: { value: number | null; allowLatest: boolean; emptyLabel?: string; onChange: (value: number | null) => void }) {
  const { t } = useI18n()
  const profilesQuery = useWallpaperChatProfiles()
  return (
    <Select value={value === null ? '' : String(value)} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{emptyLabel ?? (allowLatest ? t({ ko: '가장 최근 대화', en: 'Latest chat' }) : t({ ko: '최근 대화의 캐릭터', en: 'Latest chat’s character' }))}</option>
      {(profilesQuery.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </Select>
  )
}

/** Workflow schedules the quick-run button can press; the name is stored too because the live page cannot list them. */
function ScheduleSelect({ value, savedName, onChange }: { value: number | null; savedName: string; onChange: (value: number | null, name: string) => void }) {
  const { t } = useI18n()
  const schedulesQuery = useQuery({ queryKey: ['wallpaper-inspector', 'graph-workflow-schedules'], queryFn: () => getGraphWorkflowSchedules() })
  const schedules = schedulesQuery.data ?? []
  const missing = value !== null && !schedulesQuery.isLoading && !schedules.some((schedule) => schedule.id === value)
  return (
    <Select
      value={value === null ? '' : String(value)}
      onChange={(event) => {
        const id = event.target.value ? Number(event.target.value) : null
        onChange(id, schedules.find((schedule) => schedule.id === id)?.name ?? '')
      }}
    >
      <option value="">{t({ ko: '고르기', en: 'Pick one' })}</option>
      {missing ? <option value={value}>{savedName || `#${value}`} · {t({ ko: '없음', en: 'missing' })}</option> : null}
      {schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}
    </Select>
  )
}

/** Every audio group of every project, grouped by project. */
function AudioGroupSelect({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const { t } = useI18n()
  const projectsQuery = useQuery({ queryKey: ['wallpaper-editor', 'audio-projects'], queryFn: listAudioProjects, staleTime: 60_000 })
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const groupQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['wallpaper-editor', 'audio-groups', project.id],
      queryFn: () => listAudioGroups(project.id),
      staleTime: 60_000,
    })),
  })
  return (
    <Select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{t({ ko: '오디오 그룹 선택', en: 'Select an audio group' })}</option>
      {projects.map((project, index) => (
        <optgroup key={project.id} label={project.name}>
          {(groupQueries[index]?.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.label || group.name}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

function GroupSourceFields({ widget, groups, updateWidgetSettings }: {
  widget: Extract<WallpaperWidgetInstance, { type: 'group-image-view' | 'image-showcase' | 'floating-collage' }>
  groups: WallpaperInspectorGroupOption[]
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}) {
  const { t } = useI18n()
  return (
    <>
      <Field label={t({ ko: '그룹', en: 'Group' })}>
        <Select
          value={widget.settings.groupId !== null ? String(widget.settings.groupId) : ''}
          onChange={(event) => updateWidgetSettings({ groupId: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">{t({ ko: '그룹 선택', en: 'Select group' })}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
          ))}
        </Select>
      </Field>
      <SwitchLine label={t({ ko: '하위 그룹 포함', en: 'Include child groups' })} checked={widget.settings.includeChildren !== false} onCheckedChange={(checked) => updateWidgetSettings({ includeChildren: checked })} />
      <InspectorRow label={t({ ko: '이미지 풀', en: 'Image pool' })}>
        <Select value={String(widget.settings.poolRefreshMinutes ?? 0)} onChange={(event) => updateWidgetSettings({ poolRefreshMinutes: Number(event.target.value) })}>
          <option value="0">{t({ ko: '처음 뽑은 그대로', en: 'Keep the first draw' })}</option>
          {[5, 10, 30, 60, 180].map((minutes) => (
            <option key={minutes} value={minutes}>{t({ ko: '{minutes}분마다 새로 뽑기', en: 'Redraw every {minutes} min' }, { minutes })}</option>
          ))}
        </Select>
      </InspectorRow>
    </>
  )
}

function ImagePreviewFields({ widget, updateWidgetSettings }: { widget: WallpaperWidgetInstance; updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater }) {
  const { t } = useI18n()
  if (!isWallpaperPreviewableImageWidget(widget)) return null
  return (
    <WallpaperInspectorDisclosure title={t({ ko: '클릭 미리보기', en: 'Click preview' })}>
      <Field label={t({ ko: '이미지 클릭', en: 'Image click' })}>
        <Select value={widget.settings.imageClickAction ?? 'preview'} onChange={(event) => {
          const next = event.target.value
          updateWidgetSettings({ imageClickAction: next === 'none' || next === 'open' ? next : 'preview' })
        }}>
          <option value="preview">{t({ ko: '확대 미리보기', en: 'Open preview' })}</option>
          <option value="open">{t({ ko: 'CoNAI에서 열기', en: 'Open in CoNAI' })}</option>
          <option value="none">{t({ ko: '동작 없음', en: 'No action' })}</option>
        </Select>
      </Field>
      {widget.type === 'group-image-view' || widget.type === 'image-showcase' ? (
        <SwitchLine label={t({ ko: '호버 시 일시정지', en: 'Pause on hover' })} checked={widget.settings.pauseOnHover !== false} onCheckedChange={(checked) => updateWidgetSettings({ pauseOnHover: checked })} />
      ) : null}
      <WallpaperPreviewOpenAnimationEditorField
        scalePercent={widget.settings.imagePreviewOpenScalePercent}
        durationMs={widget.settings.imagePreviewOpenDurationMs}
        easing={widget.settings.imagePreviewOpenEasing}
        onScalePercentChange={(value) => updateWidgetSettings({ imagePreviewOpenScalePercent: value })}
        onDurationMsChange={(value) => updateWidgetSettings({ imagePreviewOpenDurationMs: value })}
        onEasingChange={(value) => updateWidgetSettings({ imagePreviewOpenEasing: value })}
      />
      <WallpaperPreviewCloseAnimationEditorField
        scalePercent={widget.settings.imagePreviewCloseScalePercent}
        durationMs={widget.settings.imagePreviewCloseDurationMs}
        easing={widget.settings.imagePreviewCloseEasing}
        onScalePercentChange={(value) => updateWidgetSettings({ imagePreviewCloseScalePercent: value })}
        onDurationMsChange={(value) => updateWidgetSettings({ imagePreviewCloseDurationMs: value })}
        onEasingChange={(value) => updateWidgetSettings({ imagePreviewCloseEasing: value })}
      />
    </WallpaperInspectorDisclosure>
  )
}

/** The widget's own tab: what it shows and where its data comes from. */
export function WallpaperWidgetTypeEditorFields({ selectedWidget, groups, updateWidgetSettings }: WallpaperWidgetTypeEditorFieldsProps) {
  const { t } = useI18n()
  const widget = selectedWidget

  const body = (() => {
    switch (widget.type) {
      case 'clock':
        return (
          <>
            <InspectorRow label={t({ ko: '모양', en: 'Look' })}>
              <Select value={normalizeWallpaperClockStyle(widget.settings.visualStyle)} onChange={(event) => updateWidgetSettings({ visualStyle: event.target.value as typeof widget.settings.visualStyle })}>
                <option value="clean">{t({ ko: '클린', en: 'Clean' })}</option>
                <option value="serif">{t({ ko: '세리프', en: 'Serif' })}</option>
                <option value="glow">{t({ ko: '글로우', en: 'Glow' })}</option>
                <option value="split">{t({ ko: '분할', en: 'Split' })}</option>
                <option value="analog">{t({ ko: '아날로그', en: 'Analog' })}</option>
                <option value="mono">{t({ ko: '모노', en: 'Mono' })}</option>
              </Select>
            </InspectorRow>
            <InspectorSegments label={t({ ko: '형식', en: 'Format' })} value={widget.settings.timeFormat} items={[{ value: '24h', label: '24h' }, { value: '12h', label: '12h' }]} onChange={(value) => updateWidgetSettings({ timeFormat: value })} />
            <SwitchLine label={t({ ko: '초', en: 'Seconds' })} checked={widget.settings.showSeconds} onCheckedChange={(checked) => updateWidgetSettings({ showSeconds: checked })} />
            <SwitchLine label={t({ ko: '날짜', en: 'Date' })} checked={widget.settings.showDate !== false} onCheckedChange={(checked) => updateWidgetSettings({ showDate: checked })} />
          </>
        )
      case 'calendar':
        return (
          <>
            <InspectorSegments label={t({ ko: '주 시작', en: 'Week starts' })} value={widget.settings.weekStart} items={[{ value: 'sun', label: t({ ko: '일요일', en: 'Sunday' }) }, { value: 'mon', label: t({ ko: '월요일', en: 'Monday' }) }]} onChange={(value) => updateWidgetSettings({ weekStart: value })} />
            <SwitchLine label={t({ ko: '앞뒤 달 날짜', en: 'Days of other months' })} checked={widget.settings.showOutsideDays} onCheckedChange={(checked) => updateWidgetSettings({ showOutsideDays: checked })} />
          </>
        )
      case 'text-note':
        return (
          <>
            <Textarea variant="settings" rows={4} aria-label={t({ ko: '내용', en: 'Text' })} value={widget.settings.text} onChange={(event) => updateWidgetSettings({ text: event.target.value })} />
            <InspectorSlider label={t({ ko: '크기', en: 'Size' })} value={widget.settings.fontSize || 40} min={10} max={240} onChange={(value) => updateWidgetSettings({ fontSize: value })} />
          </>
        )
      case 'generation-progress':
        return (
          <>
            <InspectorRow label={t({ ko: '서비스', en: 'Service' })}><ServiceSelect value={widget.settings.service} onChange={(value) => updateWidgetSettings({ service: value })} /></InspectorRow>
            <InspectorSlider label={t({ ko: '작업 수', en: 'Jobs' })} value={widget.settings.maxJobs} min={1} max={8} onChange={(value) => updateWidgetSettings({ maxJobs: value })} />
            <SwitchLine label={t({ ko: '노드 이름', en: 'Node name' })} checked={widget.settings.showNodeLabel} onCheckedChange={(checked) => updateWidgetSettings({ showNodeLabel: checked })} />
            <SwitchLine label={t({ ko: '실행 · 대기 수', en: 'Running · queued' })} checked={widget.settings.showQueueCounts} onCheckedChange={(checked) => updateWidgetSettings({ showQueueCounts: checked })} />
          </>
        )
      case 'generation-stats':
        return (
          <>
            <InspectorRow label={t({ ko: '기간', en: 'Period' })}><DaysSelect value={widget.settings.days} onChange={(value) => updateWidgetSettings({ days: value })} /></InspectorRow>
            <InspectorSegments label={t({ ko: '표시', en: 'Show' })} value={widget.settings.display} items={[{ value: 'bars', label: t({ ko: '막대', en: 'Bars' }) }, { value: 'numbers', label: t({ ko: '숫자', en: 'Numbers' }) }]} onChange={(value) => updateWidgetSettings({ display: value })} />
          </>
        )
      case 'llm-usage':
        return (
          <>
            <InspectorRow label={t({ ko: '기간', en: 'Period' })}><DaysSelect value={widget.settings.days} onChange={(value) => updateWidgetSettings({ days: value })} /></InspectorRow>
            <InspectorSegments label={t({ ko: '기준', en: 'Measure' })} value={widget.settings.metric} items={[{ value: 'tokens', label: t({ ko: '토큰', en: 'Tokens' }) }, { value: 'requests', label: t({ ko: '요청', en: 'Requests' }) }]} onChange={(value) => updateWidgetSettings({ metric: value })} />
            <SwitchLine label={t({ ko: '모델별', en: 'By model' })} checked={widget.settings.showModels} onCheckedChange={(checked) => updateWidgetSettings({ showModels: checked })} />
          </>
        )
      case 'library-stats':
        return (
          <>
            <SwitchLine label={t({ ko: '상위 태그', en: 'Top tags' })} checked={widget.settings.showTopTags} onCheckedChange={(checked) => updateWidgetSettings({ showTopTags: checked })} />
            {widget.settings.showTopTags ? <InspectorSlider label={t({ ko: '태그 수', en: 'Tags' })} value={widget.settings.tagCount} min={1} max={20} onChange={(value) => updateWidgetSettings({ tagCount: value })} /> : null}
            <SwitchLine label={t({ ko: '등급 분포', en: 'Ratings' })} checked={widget.settings.showRatings} onCheckedChange={(checked) => updateWidgetSettings({ showRatings: checked })} />
          </>
        )
      case 'character-card':
        return (
          <>
            <InspectorRow label={t({ ko: '캐릭터', en: 'Character' })}><CharacterSelect value={widget.settings.profileId} allowLatest={false} onChange={(value) => updateWidgetSettings({ profileId: value })} /></InspectorRow>
            <SwitchLine label={t({ ko: '아바타', en: 'Avatar' })} checked={widget.settings.showAvatar} onCheckedChange={(checked) => updateWidgetSettings({ showAvatar: checked })} />
            <SwitchLine label={t({ ko: '마지막 메시지', en: 'Last message' })} checked={widget.settings.showLastMessage} onCheckedChange={(checked) => updateWidgetSettings({ showLastMessage: checked })} />
            <SwitchLine label={t({ ko: '입력 중 표시', en: 'Typing indicator' })} checked={widget.settings.showTyping} onCheckedChange={(checked) => updateWidgetSettings({ showTyping: checked })} />
            <SwitchLine label={t({ ko: '안 읽은 수', en: 'Unread count' })} checked={widget.settings.showUnread} onCheckedChange={(checked) => updateWidgetSettings({ showUnread: checked })} />
            <SwitchLine label={t({ ko: '캐릭터 배경', en: 'Character background' })} checked={widget.settings.showCharacterBackground} onCheckedChange={(checked) => updateWidgetSettings({ showCharacterBackground: checked })} />
            {widget.settings.showLastMessage ? (
              <InspectorSegments
                label={t({ ko: '메시지 길이', en: 'Message length' })}
                value={String(widget.settings.messageLines)}
                items={[{ value: '1', label: t({ ko: '한 줄', en: '1 line' }) }, { value: '3', label: t({ ko: '세 줄', en: '3 lines' }) }, { value: '0', label: t({ ko: '전체', en: 'All' }) }]}
                onChange={(value) => updateWidgetSettings({ messageLines: Number(value) as 0 | 1 | 3 })}
              />
            ) : null}
          </>
        )
      case 'chat-recent':
        return (
          <>
            <InspectorRow label={t({ ko: '대화', en: 'Chat' })}><CharacterSelect value={widget.settings.profileId} allowLatest onChange={(value) => updateWidgetSettings({ profileId: value })} /></InspectorRow>
          </>
        )
      case 'audio-player':
        return (
          <>
            <InspectorRow label={t({ ko: '그룹', en: 'Group' })}><AudioGroupSelect value={widget.settings.audioGroupId} onChange={(value) => updateWidgetSettings({ audioGroupId: value })} /></InspectorRow>
            <SwitchLine label={t({ ko: '자동 재생', en: 'Autoplay' })} checked={widget.settings.autoplay} onCheckedChange={(checked) => updateWidgetSettings({ autoplay: checked })} />
            <SwitchLine label={t({ ko: '섞기', en: 'Shuffle' })} checked={widget.settings.shuffle} onCheckedChange={(checked) => updateWidgetSettings({ shuffle: checked })} />
            <InspectorSlider label={t({ ko: '음량', en: 'Volume' })} value={widget.settings.volume} min={0} max={100} unit="%" onChange={(value) => updateWidgetSettings({ volume: value })} />
          </>
        )
      case 'post-ticker':
        return (
          <>
            <InspectorSlider label={t({ ko: '글 수', en: 'Posts' })} value={widget.settings.count} min={1} max={10} onChange={(value) => updateWidgetSettings({ count: value })} />
            <SwitchLine label={t({ ko: '대표 이미지', en: 'Cover image' })} checked={widget.settings.showCover} onCheckedChange={(checked) => updateWidgetSettings({ showCover: checked })} />
          </>
        )
      case 'prompt-of-day':
        return (
          <>
            <Textarea variant="settings" rows={3} aria-label={t({ ko: '템플릿', en: 'Template' })} placeholder="__character__, __scene__, __light__" value={widget.settings.template} onChange={(event) => updateWidgetSettings({ template: event.target.value })} />
            <InspectorRow label={t({ ko: '다시 뽑기', en: 'Reroll' })}>
              <Select value={String(widget.settings.rerollMinutes)} onChange={(event) => updateWidgetSettings({ rerollMinutes: Number(event.target.value) })}>
                <option value="0">{t({ ko: '안 함', en: 'Never' })}</option>
                {[10, 30, 60, 180, 1440].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes >= 60 ? t({ ko: '{hours}시간마다', en: 'Every {hours} h' }, { hours: minutes / 60 }) : t({ ko: '{minutes}분마다', en: 'Every {minutes} min' }, { minutes })}</option>
                ))}
              </Select>
            </InspectorRow>
            <InspectorSegments label={t({ ko: '글꼴', en: 'Typeface' })} value={widget.settings.typeface} items={[{ value: 'serif', label: t({ ko: '세리프', en: 'Serif' }) }, { value: 'sans', label: t({ ko: '고딕', en: 'Sans' }) }]} onChange={(value) => updateWidgetSettings({ typeface: value })} />
          </>
        )
      case 'audio-visualizer':
        return (
          <>
            <InspectorSegments
              label={t({ ko: '모양', en: 'Shape' })}
              value={widget.settings.shape}
              items={[
                { value: 'bars', label: t({ ko: '막대', en: 'Bars' }) },
                { value: 'mirror', label: t({ ko: '대칭', en: 'Mirror' }) },
                { value: 'wave', label: t({ ko: '파형', en: 'Wave' }) },
                { value: 'circle', label: t({ ko: '원형', en: 'Circle' }) },
              ]}
              onChange={(value) => updateWidgetSettings({ shape: value })}
            />
            <InspectorSlider label={t({ ko: '막대 수', en: 'Bars' })} value={widget.settings.barCount} min={8} max={64} onChange={(value) => updateWidgetSettings({ barCount: value })} />
            <InspectorSlider label={t({ ko: '감도', en: 'Sensitivity' })} value={widget.settings.sensitivity} min={50} max={300} step={10} unit="%" onChange={(value) => updateWidgetSettings({ sensitivity: value })} />
            <InspectorSlider label={t({ ko: '부드럽게', en: 'Smoothing' })} value={widget.settings.smoothing} min={0} max={90} unit="%" onChange={(value) => updateWidgetSettings({ smoothing: value })} />
            <InspectorColor label={t({ ko: '색', en: 'Color' })} value={widget.settings.color} fallback="#7c5cff" themeVariable="--primary" nullable onChange={(value) => updateWidgetSettings({ color: value })} />
          </>
        )
      case 'now-playing':
        return (
          <>
            <InspectorSegments label={t({ ko: '배치', en: 'Layout' })} value={widget.settings.layout} items={[{ value: 'row', label: t({ ko: '가로', en: 'Row' }) }, { value: 'stack', label: t({ ko: '세로', en: 'Stack' }) }]} onChange={(value) => updateWidgetSettings({ layout: value })} />
            <SwitchLine label={t({ ko: '앨범 아트', en: 'Album art' })} checked={widget.settings.showArt} onCheckedChange={(checked) => updateWidgetSettings({ showArt: checked })} />
            <SwitchLine label={t({ ko: '재생 안 할 때 숨기기', en: 'Hide when idle' })} checked={widget.settings.hideWhenIdle} onCheckedChange={(checked) => updateWidgetSettings({ hideWhenIdle: checked })} />
          </>
        )
      case 'system-monitor':
        return (
          <>
            <InspectorSegments label={t({ ko: '대상', en: 'Source' })} value={widget.settings.source} items={[{ value: 'comfyui', label: 'ComfyUI' }, { value: 'host', label: t({ ko: '이 PC', en: 'This PC' }) }]} onChange={(value) => updateWidgetSettings({ source: value })} />
            <InspectorSegments label={t({ ko: '표시', en: 'Display' })} value={widget.settings.display} items={[{ value: 'bars', label: t({ ko: '막대', en: 'Bars' }) }, { value: 'rings', label: t({ ko: '링', en: 'Rings' }) }]} onChange={(value) => updateWidgetSettings({ display: value })} />
            {widget.settings.source === 'host' ? (
              <SwitchLine label={t({ ko: '네트워크', en: 'Network' })} checked={widget.settings.showNetwork} onCheckedChange={(checked) => updateWidgetSettings({ showNetwork: checked })} />
            ) : null}
          </>
        )
      case 'quick-run':
        return (
          <>
            <InspectorRow label={t({ ko: '예약', en: 'Schedule' })}>
              <ScheduleSelect value={widget.settings.scheduleId} savedName={widget.settings.scheduleName} onChange={(scheduleId, scheduleName) => updateWidgetSettings({ scheduleId, scheduleName })} />
            </InspectorRow>
            <InspectorRow label={t({ ko: '버튼 글자', en: 'Label' })}>
              <Input value={widget.settings.label} maxLength={40} placeholder={widget.settings.scheduleName || t({ ko: '실행', en: 'Run' })} onChange={(event) => updateWidgetSettings({ label: event.target.value })} />
            </InspectorRow>
          </>
        )
      case 'queue-status':
      case 'recent-results':
      case 'activity-pulse':
        return <WallpaperStatusWidgetEditorFields selectedWidget={widget} updateWidgetSettings={updateWidgetSettings} />
      case 'group-image-view':
      case 'image-showcase':
      case 'floating-collage':
        return <WallpaperImageWidgetEditorFields selectedWidget={widget} updateWidgetSettings={updateWidgetSettings} />
      default:
        return null
    }
  })()

  return (
    <div className="space-y-3">
      {isWallpaperGroupSourceWidget(widget) ? (
        <>
          <GroupSourceFields widget={widget} groups={groups} updateWidgetSettings={updateWidgetSettings} />
          <InspectorHeading>{t({ ko: '표시', en: 'Display' })}</InspectorHeading>
        </>
      ) : null}
      {body}
      <ImagePreviewFields widget={widget} updateWidgetSettings={updateWidgetSettings} />
    </div>
  )
}
