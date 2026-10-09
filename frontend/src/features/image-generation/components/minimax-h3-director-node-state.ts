import { applyMiniMaxDirectorResolutionBounds } from '@conai/shared'
import type { WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import type { WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import {
  buildMiniMaxH3DirectorNodeValue,
  buildMiniMaxH3DirectorPrompt,
  getMiniMaxH3DirectorAssets,
  isMiniMaxH3DirectorInputLink,
  MINIMAX_H3_DIRECTOR_MODES,
  normalizeMiniMaxH3DirectorBuilderState,
  normalizeMiniMaxH3DirectorNodeValue,
  normalizeMiniMaxH3DirectorPostprocess,
  normalizeMiniMaxH3DirectorResolution,
  parseMiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorMode,
  type MiniMaxH3DirectorPromptMode,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'

const INPAINT_MODE_BACKUP_KEY = '__conai_inpaint_mode_backup'

/** Everything the Director editor and the in-node widgets read from one stored Director value. */
export function readMiniMaxH3DirectorState(value: unknown, numericBounds?: WorkflowNodeNumericBounds) {
  let boundedValue = value
  let boundsError: string | null = null
  try {
    boundedValue = applyMiniMaxDirectorResolutionBounds(value as Record<string, unknown>, numericBounds)
  } catch (error) {
    boundsError = error instanceof Error ? error.message : String(error)
  }
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(boundedValue)
  const mode: MiniMaxH3DirectorMode | null = isMiniMaxH3DirectorInputLink(nodeValue.mode) ? null : nodeValue.mode
  const timeline = parseMiniMaxH3DirectorTimeline(isMiniMaxH3DirectorInputLink(nodeValue.timeline_data) ? '' : nodeValue.timeline_data).timeline
  const resolution = normalizeMiniMaxH3DirectorResolution(timeline.resolution)
  const postprocess = normalizeMiniMaxH3DirectorPostprocess(timeline.postprocess)
  const promptValue = isMiniMaxH3DirectorInputLink(nodeValue.prompt) ? '' : nodeValue.prompt
  const builderMode = mode ?? (
    !isMiniMaxH3DirectorInputLink(nodeValue.builder_state)
      ? (() => {
          try {
            const parsed = JSON.parse(nodeValue.builder_state) as { mode?: unknown }
            return MINIMAX_H3_DIRECTOR_MODES.includes(parsed.mode as MiniMaxH3DirectorMode) ? parsed.mode as MiniMaxH3DirectorMode : 'FL2VA'
          } catch {
            return 'FL2VA'
          }
        })()
      : 'FL2VA'
  )
  const builderDuration = isMiniMaxH3DirectorInputLink(nodeValue.duration) ? 5 : nodeValue.duration
  const builderState = normalizeMiniMaxH3DirectorBuilderState(
    isMiniMaxH3DirectorInputLink(nodeValue.builder_state) ? null : nodeValue.builder_state,
    timeline,
    builderMode,
    builderDuration,
    promptValue,
  )
  return {
    boundsError,
    nodeValue,
    mode,
    timeline,
    resolution,
    postprocess,
    promptValue,
    builderMode,
    builderDuration,
    builderState,
    assets: getMiniMaxH3DirectorAssets(nodeValue),
  }
}

export type MiniMaxH3DirectorState = ReturnType<typeof readMiniMaxH3DirectorState>

/**
 * The next stored Director value after a change. Width or height under numeric bounds switch the resolution to
 * fixed custom pixels so the bounds keep applying. Throws when the result breaks those bounds.
 */
export function patchMiniMaxH3DirectorValue(
  state: MiniMaxH3DirectorState,
  numericBounds: WorkflowNodeNumericBounds | undefined,
  inputPatch: Record<string, unknown>,
  nextTimeline?: MiniMaxH3DirectorTimeline,
  nextAssets: Record<string, WorkflowInputAssetRef> = state.assets,
  nextBuilderState?: MiniMaxH3DirectorBuilderState,
) {
  let timeline = nextTimeline
  if ((inputPatch.width !== undefined || inputPatch.height !== undefined)
    && ['width', 'height', 'resolution_mp'].some((key) => numericBounds?.[key]?.min !== undefined || numericBounds?.[key]?.max !== undefined)) {
    timeline = {
      ...(timeline ?? state.timeline),
      resolution: {
        ...state.resolution, resolution: 'custom', custom_mode: 'fixed',
        custom_width: Number(inputPatch.width ?? state.nodeValue.width),
        custom_height: Number(inputPatch.height ?? state.nodeValue.height),
      },
    }
  }
  const nextValue = buildMiniMaxH3DirectorNodeValue(state.nodeValue, inputPatch, timeline, nextAssets, nextBuilderState)
  return applyMiniMaxDirectorResolutionBounds(nextValue, numericBounds)
}

/**
 * Timeline items after a mode switch: Image Inpaint keeps only the first image (remembering where every item was),
 * and leaving Image Inpaint puts them back.
 */
export function applyMiniMaxH3DirectorModeTimeline(
  timeline: MiniMaxH3DirectorTimeline,
  currentMode: MiniMaxH3DirectorMode | null,
  nextMode: MiniMaxH3DirectorMode,
): MiniMaxH3DirectorTimeline {
  if (nextMode === 'Image Inpaint' && currentMode !== 'Image Inpaint') {
    const selectedImageId = timeline.items
      .filter((item) => item.enabled !== false && item.type === 'image')
      .sort((left, right) => left.slot - right.slot || left.order - right.order)[0]?.id
    return {
      ...timeline,
      items: timeline.items.map((item) => ({
        ...item,
        enabled: item.id === selectedImageId,
        ...(item.id === selectedImageId ? { slot: 0, start: 0 } : {}),
        [INPAINT_MODE_BACKUP_KEY]: {
          enabled: item.enabled,
          slot: item.slot,
          start: item.start,
        },
      })),
    }
  }
  if (currentMode === 'Image Inpaint' && nextMode !== 'Image Inpaint') {
    return {
      ...timeline,
      items: timeline.items.map((item) => {
        const backup = item[INPAINT_MODE_BACKUP_KEY]
        if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return item
        const restored: MiniMaxH3DirectorTimelineItem = {
          ...item,
          enabled: (backup as Record<string, unknown>).enabled !== false,
          slot: Number((backup as Record<string, unknown>).slot ?? item.slot),
          start: Number((backup as Record<string, unknown>).start ?? item.start),
        }
        delete restored[INPAINT_MODE_BACKUP_KEY]
        return restored
      }),
    }
  }
  return timeline
}

/** The value after switching the generation mode (timeline items and builder state follow). */
export function changeMiniMaxH3DirectorMode(state: MiniMaxH3DirectorState, numericBounds: WorkflowNodeNumericBounds | undefined, nextMode: MiniMaxH3DirectorMode) {
  return patchMiniMaxH3DirectorValue(
    state,
    numericBounds,
    { mode: nextMode },
    applyMiniMaxH3DirectorModeTimeline(state.timeline, state.mode, nextMode),
    state.assets,
    { ...state.builderState, mode: nextMode, version: nextMode === 'REF2VA' ? 2 : 1 },
  )
}

/** Builder state after switching prompt mode; going to simple keeps the structured text as the simple prompt. */
export function setMiniMaxH3DirectorPromptMode(state: MiniMaxH3DirectorBuilderState, nextPromptMode: MiniMaxH3DirectorPromptMode): MiniMaxH3DirectorBuilderState {
  if (nextPromptMode === state.prompt_mode) return state
  if (nextPromptMode === 'simple') {
    return {
      ...state,
      prompt_mode: 'simple',
      simple_prompt: buildMiniMaxH3DirectorPrompt({ ...state, prompt_mode: 'structured' }),
    }
  }
  return { ...state, prompt_mode: 'structured' }
}
