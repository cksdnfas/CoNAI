/** The prompt part of a DaSiWa Director `builder_state`. */
export type MiniMaxH3DirectorPromptFields = {
  mode: string
  duration: number
  prompt_mode: string
  simple_prompt: string
  imd: string
  soundscape: string
  music: string
  ref: {
    subject_definitions: string
    summary: string
    retention_analysis: string
    detailed_description: string
    soundscape: string
    music: string
    [key: string]: unknown
  }
}

const REF_SECTION_KEYS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'soundscape', 'music'] as const
/** Older DaSiWa `ref` fields that the Director still folds into the sections above. */
const LEGACY_REF_DEFAULTS: Record<string, unknown> = { subject_defs: [], summary_text: '', retention: [], style_line: '', detail: '' }

function alignMiniMaxFrameCount(frameCount: number) {
  let aligned = Math.max(5, Math.trunc(frameCount))
  while (aligned % 17 !== 5) aligned += 1
  return aligned
}

function formatMiniMaxAlignedSeconds(duration: number) {
  // A linked duration arrives as NaN; the frame alignment loop needs a finite count.
  const seconds = alignMiniMaxFrameCount(Math.trunc((Number.isFinite(duration) ? duration : 5) * 24)) / 24
  return (Math.round(seconds * 100) / 100).toFixed(2)
}

/** The headed prompt text DaSiWa's Python helper renders from the per-section fields. */
export function buildMiniMaxH3DirectorSectionedPrompt(state: MiniMaxH3DirectorPromptFields) {
  if (state.mode === 'REF2VA') {
    return [
      `subject_definitions:\n${state.ref.subject_definitions.trim()}`,
      `summary:\n${state.ref.summary.trim()}`,
      `retention_analysis:\n${state.ref.retention_analysis.trim()}`,
      `detailed_description:\n${state.ref.detailed_description.trim()}`,
      `overall_soundscape:\n${state.ref.soundscape.trim()}`,
      `non_diegetic_music:\n${state.ref.music.trim() || 'N/A'}`,
    ].join('\n\n')
  }

  const end = formatMiniMaxAlignedSeconds(state.duration)
  const alignment = state.mode === 'I2VA'
    ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    : state.mode === 'FL2VA'
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the ${end}-second mark of the target video.`
      : state.mode === 'L2VA'
        ? `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the ${end}-second mark of the target video.`
        : ''
  const body = [
    `integrated_multimodal_description: ${state.imd.trim()}`,
    `overall_soundscape: ${state.soundscape.trim()}`,
    `non_diegetic_music: ${state.music.trim() || 'N/A'}`,
  ].join('\n\n')
  return alignment ? `${alignment}\n\n${body}` : body
}

function hasSectionContent(state: MiniMaxH3DirectorPromptFields) {
  const values = state.mode === 'REF2VA'
    ? REF_SECTION_KEYS.map((key) => state.ref[key])
    : [state.imd, state.soundscape, state.music]
  // 'N/A' is the music placeholder DaSiWa also ignores when deciding whether anything was written.
  return values.some((value) => value.trim().length > 0 && value.trim() !== 'N/A')
}

/**
 * Keep the whole prompt in `simple_prompt`, as the DaSiWa Director UI does. Section fields written by an
 * older editor or tool become headed text when they were the active prompt (structured mode, or simple mode
 * that never stored its own text); they are then emptied because the Director still scans them
 * (e.g. for `<RefMod N>` tags) even though it renders only the single prompt.
 */
export function collapseMiniMaxH3DirectorPrompt<T extends MiniMaxH3DirectorPromptFields>(state: T): T {
  const ref: T['ref'] = { ...state.ref }
  for (const key of REF_SECTION_KEYS) ref[key] = ''
  for (const [key, empty] of Object.entries(LEGACY_REF_DEFAULTS)) {
    if (key in ref) (ref as Record<string, unknown>)[key] = empty
  }
  return {
    ...state,
    prompt_mode: 'simple',
    simple_prompt: (state.prompt_mode !== 'simple' || !state.simple_prompt.trim()) && hasSectionContent(state)
      ? buildMiniMaxH3DirectorSectionedPrompt(state)
      : state.simple_prompt,
    imd: '',
    soundscape: '',
    music: '',
    ref,
  }
}

/** The prompt text a raw stored `builder_state` ends up as once it is collapsed for sending. */
export function readMiniMaxH3DirectorPromptText(builder: Record<string, unknown>, mode: string): string {
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const sourceRef = builder.ref && typeof builder.ref === 'object' && !Array.isArray(builder.ref) ? builder.ref as Record<string, unknown> : {}
  return collapseMiniMaxH3DirectorPrompt({
    mode,
    duration: Number(builder.duration),
    prompt_mode: text(builder.prompt_mode) || 'structured',
    simple_prompt: text(builder.simple_prompt),
    imd: text(builder.imd),
    soundscape: text(builder.soundscape),
    music: text(builder.music),
    ref: {
      subject_definitions: text(sourceRef.subject_definitions),
      summary: text(sourceRef.summary),
      retention_analysis: text(sourceRef.retention_analysis),
      detailed_description: text(sourceRef.detailed_description),
      soundscape: text(sourceRef.soundscape),
      music: text(sourceRef.music),
    },
  }).simple_prompt
}
