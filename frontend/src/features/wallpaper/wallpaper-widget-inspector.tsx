import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import { cn } from '@/lib/utils'
import { getWallpaperWidgetDefinition } from './wallpaper-widget-registry'
import type { WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetInspectorPatch {
  x?: number
  y?: number
  w?: number
  h?: number
  zIndex?: number
  locked?: boolean
  hidden?: boolean
  settings?: WallpaperWidgetInstance['settings']
}

interface WallpaperWidgetInspectorProps {
  selectedWidget: WallpaperWidgetInstance | null
  groups: Array<{ id: number; name: string; depth?: number | null }>
  widgetCount: number
  widgetOrder: number | null
  onPatchWidget: (widgetId: string, patch: WallpaperWidgetInspectorPatch) => void
  onChangeWidgetOrder: (widgetId: string, nextOrder: number) => void
  onRemoveWidget: (widgetId: string) => void
}

/** Render the editor inspector for one selected wallpaper widget. */
export function WallpaperWidgetInspector({ selectedWidget, groups, widgetCount, widgetOrder, onPatchWidget, onChangeWidgetOrder, onRemoveWidget }: WallpaperWidgetInspectorProps) {
  if (!selectedWidget) {
    return (
      <div className={cn('rounded-sm border border-dashed border-border bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground')}>
        위젯을 선택해.
      </div>
    )
  }

  const updateWidgetSettings = (settingsPatch: Partial<WallpaperWidgetInstance['settings']>) => {
    onPatchWidget(selectedWidget.id, {
      settings: {
        ...selectedWidget.settings,
        ...settingsPatch,
      } as WallpaperWidgetInstance['settings'],
    })
  }

  return (
    <>
      <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
        <div className="text-sm font-medium text-foreground">{getWallpaperWidgetDefinition(selectedWidget.type).title}</div>
        <SettingsField label="제목">
          <input
            className="theme-settings-control h-9 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
            value={selectedWidget.settings.title}
            onChange={(event) => {
              updateWidgetSettings({ title: event.target.value })
            }}
          />
        </SettingsField>

        {selectedWidget.type === 'clock' ? (
          <>
            <SettingsField label="스타일">
              <Select
                value={selectedWidget.settings.visualStyle ?? 'minimal'}
                onChange={(event) => {
                  updateWidgetSettings({
                    visualStyle: event.target.value === 'glow' ? 'glow' : event.target.value === 'split' ? 'split' : 'minimal',
                  })
                }}
              >
                <option value="minimal">미니멀</option>
                <option value="glow">글로우</option>
                <option value="split">분할</option>
              </Select>
            </SettingsField>
            <SettingsField label="시간 형식">
              <Select
                value={selectedWidget.settings.timeFormat}
                onChange={(event) => {
                  updateWidgetSettings({
                    timeFormat: event.target.value === '12h' ? '12h' : '24h',
                  })
                }}
              >
                <option value="24h">24h</option>
                <option value="12h">12h</option>
              </Select>
            </SettingsField>
            <SettingsToggleRow>
              <span className="flex-1">초 표시</span>
              <input
                type="checkbox"
                checked={selectedWidget.settings.showSeconds}
                onChange={(event) => {
                  updateWidgetSettings({ showSeconds: event.target.checked })
                }}
              />
            </SettingsToggleRow>
          </>
        ) : null}

        {selectedWidget.type === 'queue-status' ? (
          <>
            <SettingsField label="새로고침">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="표시 방식">
              <Select
                value={selectedWidget.settings.visualMode ?? 'tiles'}
                onChange={(event) => {
                  updateWidgetSettings({
                    visualMode: event.target.value === 'bars' ? 'bars' : event.target.value === 'rings' ? 'rings' : 'tiles',
                  })
                }}
              >
                <option value="tiles">타일</option>
                <option value="bars">막대</option>
                <option value="rings">링</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'recent-results' ? (
          <>
            <SettingsField label="새로고침">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="배치">
              <Select
                value={selectedWidget.settings.displayMode ?? 'grid'}
                onChange={(event) => {
                  updateWidgetSettings({ displayMode: event.target.value === 'stack' ? 'stack' : 'grid' })
                }}
              >
                <option value="grid">그리드</option>
                <option value="stack">스택</option>
              </Select>
            </SettingsField>

            <SettingsField label="표시 개수">
              <Select
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 3, 4, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="전환 간격">
              <Select
                value={String(selectedWidget.settings.shiftIntervalSec ?? 8)}
                onChange={(event) => {
                  updateWidgetSettings({ shiftIntervalSec: Number(event.target.value) })
                }}
              >
                {[4, 6, 8, 12, 16].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="전환">
              <Select
                value={selectedWidget.settings.imageTransitionStyle ?? 'zoom'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionStyle: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'fade'
                        ? 'fade'
                        : event.target.value === 'slide'
                          ? 'slide'
                          : event.target.value === 'blur'
                            ? 'blur'
                            : event.target.value === 'flip'
                              ? 'flip'
                              : event.target.value === 'shuffle'
                                ? 'shuffle'
                                : 'zoom',
                  })
                }}
              >
                <option value="zoom">줌</option>
                <option value="fade">페이드</option>
                <option value="slide">슬라이드</option>
                <option value="blur">블러</option>
                <option value="flip">플립</option>
                <option value="shuffle">셔플</option>
                <option value="none">없음</option>
              </Select>
            </SettingsField>

            <SettingsField label="속도">
              <Select
                value={selectedWidget.settings.imageTransitionSpeed ?? 'normal'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionSpeed: event.target.value === 'fast'
                      ? 'fast'
                      : event.target.value === 'slow'
                        ? 'slow'
                        : 'normal',
                  })
                }}
              >
                <option value="fast">빠름</option>
                <option value="normal">보통</option>
                <option value="slow">느림</option>
              </Select>
            </SettingsField>

            <SettingsField label="호버 반응">
              <Select
                value={selectedWidget.settings.imageHoverMotion ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageHoverMotion: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'soft'
                        ? 'soft'
                        : event.target.value === 'strong'
                          ? 'strong'
                          : 'medium',
                  })
                }}
              >
                <option value="none">없음</option>
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'activity-pulse' ? (
          <>
            <SettingsField label="새로고침">
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[3, 5, 10, 15, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="강조 대상">
              <Select
                value={selectedWidget.settings.emphasis ?? 'mixed'}
                onChange={(event) => {
                  updateWidgetSettings({
                    emphasis: event.target.value === 'queue' ? 'queue' : event.target.value === 'results' ? 'results' : 'mixed',
                  })
                }}
              >
                <option value="mixed">혼합</option>
                <option value="queue">큐</option>
                <option value="results">결과</option>
              </Select>
            </SettingsField>

            <SettingsField label="강도">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'image-showcase' ? (
          <>
            <SettingsField label="재생 방식">
              <Select
                value={selectedWidget.settings.playbackMode ?? 'carousel'}
                onChange={(event) => {
                  updateWidgetSettings({
                    playbackMode: event.target.value === 'static'
                      ? 'static'
                      : event.target.value === 'ken-burns'
                        ? 'ken-burns'
                        : 'carousel',
                  })
                }}
              >
                <option value="carousel">캐러셀</option>
                <option value="ken-burns">켄 번즈</option>
                <option value="static">고정</option>
              </Select>
            </SettingsField>

            <SettingsField label="간격">
              <Select
                value={String(selectedWidget.settings.slideshowIntervalSec ?? 20)}
                onChange={(event) => {
                  updateWidgetSettings({ slideshowIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 20, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="채우기 방식">
              <Select
                value={selectedWidget.settings.fitMode}
                onChange={(event) => {
                  updateWidgetSettings({ fitMode: event.target.value === 'contain' ? 'contain' : 'cover' })
                }}
              >
                <option value="cover">채우기</option>
                <option value="contain">맞춤</option>
              </Select>
            </SettingsField>

            <SettingsField label="전환">
              <Select
                value={selectedWidget.settings.imageTransitionStyle ?? 'fade'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionStyle: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'zoom'
                        ? 'zoom'
                        : event.target.value === 'slide'
                          ? 'slide'
                          : event.target.value === 'blur'
                            ? 'blur'
                            : event.target.value === 'flip'
                              ? 'flip'
                              : event.target.value === 'shuffle'
                                ? 'shuffle'
                                : 'fade',
                  })
                }}
              >
                <option value="fade">페이드</option>
                <option value="zoom">줌</option>
                <option value="slide">슬라이드</option>
                <option value="blur">블러</option>
                <option value="flip">플립</option>
                <option value="shuffle">셔플</option>
                <option value="none">없음</option>
              </Select>
            </SettingsField>

            <SettingsField label="속도">
              <Select
                value={selectedWidget.settings.imageTransitionSpeed ?? 'normal'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionSpeed: event.target.value === 'fast'
                      ? 'fast'
                      : event.target.value === 'slow'
                        ? 'slow'
                        : 'normal',
                  })
                }}
              >
                <option value="fast">빠름</option>
                <option value="normal">보통</option>
                <option value="slow">느림</option>
              </Select>
            </SettingsField>

            <SettingsField label="호버 반응">
              <Select
                value={selectedWidget.settings.imageHoverMotion ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageHoverMotion: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'soft'
                        ? 'soft'
                        : event.target.value === 'strong'
                          ? 'strong'
                          : 'medium',
                  })
                }}
              >
                <option value="none">없음</option>
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' || selectedWidget.type === 'floating-collage' ? (
          <SettingsField label="그룹">
            <Select
              value={selectedWidget.settings.groupId !== null ? String(selectedWidget.settings.groupId) : ''}
              onChange={(event) => {
                const nextValue = event.target.value
                updateWidgetSettings({ groupId: nextValue ? Number(nextValue) : null })
              }}
            >
              <option value="">그룹 선택</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
              ))}
            </Select>
          </SettingsField>
        ) : null}

        {selectedWidget.type === 'group-image-view' ? (
          <>
            <SettingsField label="표시 개수">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 4, 6, 9].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="움직임">
              <Select
                value={selectedWidget.settings.motionMode ?? 'static'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionMode: event.target.value === 'pointer' ? 'pointer' : event.target.value === 'ambient' ? 'ambient' : 'static',
                  })
                }}
              >
                <option value="static">고정</option>
                <option value="ambient">앰비언트</option>
                <option value="pointer">반응형</option>
              </Select>
            </SettingsField>

            <SettingsField label="강도">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>

            <SettingsField label="전환">
              <Select
                value={selectedWidget.settings.imageTransitionStyle ?? 'fade'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionStyle: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'zoom'
                        ? 'zoom'
                        : event.target.value === 'slide'
                          ? 'slide'
                          : event.target.value === 'blur'
                            ? 'blur'
                            : event.target.value === 'flip'
                              ? 'flip'
                              : event.target.value === 'shuffle'
                                ? 'shuffle'
                                : 'fade',
                  })
                }}
              >
                <option value="fade">페이드</option>
                <option value="zoom">줌</option>
                <option value="slide">슬라이드</option>
                <option value="blur">블러</option>
                <option value="flip">플립</option>
                <option value="shuffle">셔플</option>
                <option value="none">없음</option>
              </Select>
            </SettingsField>

            <SettingsField label="속도">
              <Select
                value={selectedWidget.settings.imageTransitionSpeed ?? 'normal'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageTransitionSpeed: event.target.value === 'fast'
                      ? 'fast'
                      : event.target.value === 'slow'
                        ? 'slow'
                        : 'normal',
                  })
                }}
              >
                <option value="fast">빠름</option>
                <option value="normal">보통</option>
                <option value="slow">느림</option>
              </Select>
            </SettingsField>

            <SettingsField label="호버 반응">
              <Select
                value={selectedWidget.settings.imageHoverMotion ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageHoverMotion: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'soft'
                        ? 'soft'
                        : event.target.value === 'strong'
                          ? 'strong'
                          : 'medium',
                  })
                }}
              >
                <option value="none">없음</option>
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'floating-collage' ? (
          <>
            <SettingsField label="표시 개수">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="움직임 강도">
              <Select
                value={selectedWidget.settings.motionStrength ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionStrength: event.target.value === 'soft' ? 'soft' : event.target.value === 'strong' ? 'strong' : 'medium',
                  })
                }}
              >
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>

            <SettingsField label="초기 밀집도">
              <Select
                value={selectedWidget.settings.layoutSpread ?? 'compact'}
                onChange={(event) => {
                  updateWidgetSettings({
                    layoutSpread: event.target.value === 'wide' ? 'wide' : event.target.value === 'balanced' ? 'balanced' : 'compact',
                  })
                }}
              >
                <option value="compact">조밀하게</option>
                <option value="balanced">보통</option>
                <option value="wide">넓게</option>
              </Select>
            </SettingsField>

            <SettingsField label="이동 속도">
              <ScrubbableNumberInput
                variant="settings"
                min={0.2}
                max={20}
                step={0.1}
                scrubRatio={0.45}
                value={selectedWidget.settings.motionSpeed ?? 1}
                onChange={(nextValue) => {
                  const parsed = Number(nextValue)
                  updateWidgetSettings({
                    motionSpeed: Number.isFinite(parsed) ? Math.min(20, Math.max(0.2, parsed)) : 1,
                  })
                }}
              />
            </SettingsField>

            <SettingsField label="이미지 크기(%)">
              <ScrubbableNumberInput
                variant="settings"
                min={50}
                max={200}
                step={1}
                scrubRatio={0.35}
                value={selectedWidget.settings.imageScalePercent ?? 100}
                onChange={(nextValue) => {
                  const parsed = Number(nextValue)
                  updateWidgetSettings({
                    imageScalePercent: Number.isFinite(parsed) ? Math.min(200, Math.max(50, Math.round(parsed))) : 100,
                  })
                }}
              />
            </SettingsField>

            <SettingsField label="이미지 교체 기준">
              <Select
                value={selectedWidget.settings.imageSwapMode ?? 'bounce'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageSwapMode: event.target.value === 'time' ? 'time' : 'bounce',
                  })
                }}
              >
                <option value="bounce">튕김 횟수</option>
                <option value="time">시간</option>
              </Select>
            </SettingsField>

            {selectedWidget.settings.imageSwapMode === 'time' ? (
              <SettingsField label="교체 간격(초)">
                <ScrubbableNumberInput
                  variant="settings"
                  min={2}
                  max={60}
                  step={1}
                  scrubRatio={0.35}
                  value={selectedWidget.settings.swapIntervalSec ?? 12}
                  onChange={(nextValue) => {
                    const parsed = Number(nextValue)
                    updateWidgetSettings({
                      swapIntervalSec: Number.isFinite(parsed) ? Math.min(60, Math.max(2, Math.round(parsed))) : 12,
                    })
                  }}
                />
              </SettingsField>
            ) : (
              <SettingsField label="교체까지 튕김 수">
                <ScrubbableNumberInput
                  variant="settings"
                  min={1}
                  max={12}
                  step={1}
                  scrubRatio={0.35}
                  value={selectedWidget.settings.swapBounceCount ?? 3}
                  onChange={(nextValue) => {
                    const parsed = Number(nextValue)
                    updateWidgetSettings({
                      swapBounceCount: Number.isFinite(parsed) ? Math.min(12, Math.max(1, Math.round(parsed))) : 3,
                    })
                  }}
                />
              </SettingsField>
            )}

            <SettingsField label="비율 기준">
              <Select
                value={selectedWidget.settings.aspectMode ?? 'image'}
                onChange={(event) => {
                  updateWidgetSettings({
                    aspectMode: event.target.value === 'slot' ? 'slot' : 'image',
                  })
                }}
              >
                <option value="image">이미지 비율</option>
                <option value="slot">슬롯 고정</option>
              </Select>
            </SettingsField>

            <SettingsField label="채우기 방식">
              <Select
                value={selectedWidget.settings.fitMode ?? 'cover'}
                onChange={(event) => {
                  updateWidgetSettings({
                    fitMode: event.target.value === 'contain' ? 'contain' : 'cover',
                  })
                }}
              >
                <option value="cover">채우기</option>
                <option value="contain">맞춤</option>
              </Select>
            </SettingsField>

            <SettingsField label="호버 반응">
              <Select
                value={selectedWidget.settings.imageHoverMotion ?? 'medium'}
                onChange={(event) => {
                  updateWidgetSettings({
                    imageHoverMotion: event.target.value === 'none'
                      ? 'none'
                      : event.target.value === 'soft'
                        ? 'soft'
                        : event.target.value === 'strong'
                          ? 'strong'
                          : 'medium',
                  })
                }}
              >
                <option value="none">없음</option>
                <option value="soft">약함</option>
                <option value="medium">보통</option>
                <option value="strong">강함</option>
              </Select>
            </SettingsField>
          </>
        ) : null}

        {selectedWidget.type === 'text-note' ? (
          <SettingsField label="내용">
            <textarea
              className="theme-settings-control min-h-24 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
              value={selectedWidget.settings.text}
              onChange={(event) => {
                updateWidgetSettings({ text: event.target.value })
              }}
            />
          </SettingsField>
        ) : null}

        {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' || selectedWidget.type === 'floating-collage' ? (
          <SettingsToggleRow>
            <span className="flex-1">하위 그룹 포함</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.includeChildren !== false}
              onChange={(event) => {
                updateWidgetSettings({ includeChildren: event.target.checked })
              }}
            />
          </SettingsToggleRow>
        ) : null}

        <SettingsToggleRow>
          <span className="flex-1">제목 표시</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showTitle !== false}
            onChange={(event) => {
              updateWidgetSettings({ showTitle: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">배경 표시</span>
          <input
            type="checkbox"
            checked={selectedWidget.settings.showBackground !== false}
            onChange={(event) => {
              updateWidgetSettings({ showBackground: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">위젯 숨김</span>
          <input
            type="checkbox"
            checked={selectedWidget.hidden}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { hidden: event.target.checked })
            }}
          />
        </SettingsToggleRow>
        <SettingsToggleRow>
          <span className="flex-1">위젯 잠금</span>
          <input
            type="checkbox"
            checked={selectedWidget.locked}
            onChange={(event) => {
              onPatchWidget(selectedWidget.id, { locked: event.target.checked })
            }}
          />
        </SettingsToggleRow>
      </div>

      <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
        <SettingsField label="순서 (1 = 맨 앞)">
          <ScrubbableNumberInput
            variant="settings"
            min={1}
            max={Math.max(1, widgetCount)}
            step={1}
            scrubRatio={0.35}
            value={widgetOrder ?? 1}
            onChange={(nextValue) => {
              const parsed = Number(nextValue)
              onChangeWidgetOrder(selectedWidget.id, Number.isFinite(parsed) ? parsed : 1)
            }}
          />
        </SettingsField>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['X', selectedWidget.x],
            ['Y', selectedWidget.y],
            ['W', selectedWidget.w],
            ['H', selectedWidget.h],
          ].map(([label, value]) => (
            <SettingsValueTile key={String(label)} label={label} value={value} className="bg-background px-3 py-2" valueClassName="mt-1 text-sm font-medium" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '←', patch: { x: selectedWidget.x - 1 } },
            { label: '→', patch: { x: selectedWidget.x + 1 } },
            { label: '↑', patch: { y: selectedWidget.y - 1 } },
            { label: '↓', patch: { y: selectedWidget.y + 1 } },
            { label: 'W-', patch: { w: selectedWidget.w - 1 } },
            { label: 'W+', patch: { w: selectedWidget.w + 1 } },
            { label: 'H-', patch: { h: selectedWidget.h - 1 } },
            { label: 'H+', patch: { h: selectedWidget.h + 1 } },
          ].map(({ label, patch }) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              disabled={selectedWidget.locked}
              onClick={() => onPatchWidget(selectedWidget.id, patch)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <Button
        variant="destructive"
        className="w-full"
        onClick={() => {
          onRemoveWidget(selectedWidget.id)
        }}
      >
        <Trash2 className="h-4 w-4" />
        위젯 삭제
      </Button>
    </>
  )
}
