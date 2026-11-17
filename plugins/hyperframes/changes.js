// Pure helpers of the editor page: source names, where a source is used, the list of what an AI run changed, and the
// request text for a profile run. No DOM and no state, so the page and its tests share one definition.
import { composeHtml, applyControls } from './project.mjs'

const KINDS = { image: '이미지', video: '영상', audio: '오디오' }
export const kindLabel = asset => KINDS[asset?.mimeType?.split('/')[0]] ?? '소재'
export const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

/**
 * Every source's name, unique within the project (mentions and the AI's source list rely on it): its label, or "이미지 2"
 * counted among sources of the same kind. A label is kept as typed unless another source already took it, then it gets " 2",
 * " 3"…; a default name steps past any name in use, so a label like "이미지 3" never shares its name with another source.
 */
function namesOf(assets) {
  const labels = new Set(assets.flatMap(asset => asset.label ? [asset.label] : [])), taken = new Set(), names = new Map(), counts = {}
  for (const asset of assets) if (asset.label) {
    let name = asset.label, n = 2
    while (taken.has(name)) { do name = `${asset.label} ${n++}`; while (labels.has(name)) }
    taken.add(name); names.set(asset.id, name)
  }
  for (const asset of assets) if (!asset.label) {
    const kind = kindLabel(asset)
    let n = counts[kind] = (counts[kind] ?? 0) + 1, name = `${kind} ${n}`
    while (taken.has(name)) name = `${kind} ${++n}`
    taken.add(name); names.set(asset.id, name)
  }
  return names
}
export const assetName = (assets, asset) => namesOf(assets).get(asset.id) ?? asset.label ?? kindLabel(asset)
const nameById = (assets, id) => { const asset = assets.find(other => other.id === id); return asset ? assetName(assets, asset) : '빈 장면' }

/** A short default label from a prompt or file name, distinct from every name already shown. */
export function defaultLabel(text, assets) {
  const base = Array.from(String(text ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').split(/[,，、\n]/)[0].replace(/\s+/g, ' ').trim()).slice(0, 16).join('').trim()
  if (!base) return ''
  const taken = new Set(assets.flatMap(asset => [asset.label, assetName(assets, asset)]))
  let label = base, n = 2
  while (taken.has(label)) label = `${base} ${n++}`
  return label
}

/** asset id → where it is used: "장면 1, 3", "배경 음악" or "미사용". */
export function usageOf(assets, scenes) {
  const usage = new Map()
  for (const asset of assets) {
    if (asset.mimeType?.startsWith('audio/')) { usage.set(asset.id, '배경 음악'); continue }
    const used = scenes.flatMap((scene, index) => scene.asset === asset.id ? [index + 1] : [])
    usage.set(asset.id, used.length ? `장면 ${used.join(', ')}` : '미사용')
  }
  return usage
}

/** The html a storyboard produces, with the control values written in, exactly as the editor builds it. */
export const builtHtml = ({ width, height, assets, style, controls }, scenes) => applyControls(composeHtml({ width, height, assets, style }, scenes), controls ?? [])
const isBuilt = project => !!project.scenes?.length && project.html === builtHtml(project, project.scenes)
const withoutControls = html => html.replace(/<style id="hf-controls">[^<]*<\/style>/, '')

const FIELDS = [['caption', '자막'], ['seconds', '길이'], ['motion', '움직임'], ['transition', '전환'], ['captionPosition', '자막 위치']]
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** Pairs of scene indexes that show the same source in the same order (longest common subsequence). */
function align(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) table[i][j] = before[i].asset === after[j].asset ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const pairs = []
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i].asset === after[j].asset) { pairs.push([i, j]); i++; j++ } else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++
  }
  return pairs
}
const controlValue = control => control.type === 'toggle' ? (control.value ? '켬' : '끔') : `${control.value}${control.unit ?? ''}`

/**
 * What a run changed, computed from the draft before and after it: [{ text, note? }]. A project saved without a storyboard
 * has no scenes to compare; the editor invents default ones for display, which the caller must not pass in.
 */
export function summarize(before, after) {
  const items = [], oldScenes = before.scenes, newScenes = after.scenes
  if (oldScenes && newScenes) {
    const pairs = align(oldScenes, newScenes), keptOld = new Set(pairs.map(pair => pair[0])), keptNew = new Set(pairs.map(pair => pair[1]))
    oldScenes.forEach((scene, i) => { if (!keptOld.has(i)) items.push({ text: `장면 ${i + 1} 삭제 · ${nameById(before.assets, scene.asset)}` }) })
    newScenes.forEach((scene, j) => { if (!keptNew.has(j)) items.push({ text: `장면 ${j + 1} 추가 · ${nameById(after.assets, scene.asset)} · ${scene.seconds}초`, note: scene.caption ? `자막 “${scene.caption}”` : undefined }) })
    for (const [i, j] of pairs) {
      const changed = FIELDS.filter(([key]) => !same(oldScenes[i][key], newScenes[j][key]))
      if (!changed.length) continue
      const [key, label] = changed[0], show = value => value === undefined || value === '' ? '없음' : key === 'seconds' || key === 'transition' ? `${value}초` : String(value)
      items.push({ text: `장면 ${j + 1} 변경 · ${changed.map(field => field[1]).join(', ')}`, note: changed.length === 1 ? `${label} ${show(oldScenes[i][key])} → ${show(newScenes[j][key])}` : undefined })
    }
  }
  const oldAssets = new Map(before.assets.map(asset => [asset.id, asset])), newAssets = new Map(after.assets.map(asset => [asset.id, asset]))
  for (const asset of before.assets) if (!newAssets.has(asset.id)) items.push({ text: `소재 삭제 · ${assetName(before.assets, asset)}` })
  for (const asset of after.assets) {
    const old = oldAssets.get(asset.id)
    if (!old) items.push({ text: `소재 추가 · ${assetName(after.assets, asset)}` })
    else if (old.label !== asset.label) items.push({ text: `소재 이름 변경 · ${assetName(before.assets, old)} → ${assetName(after.assets, asset)}` })
  }
  if (withoutControls(before.html) !== withoutControls(after.html) && !(isBuilt(before) && isBuilt(after))) items.push({ text: '영상 HTML 수정' })
  const oldControls = new Map((before.controls ?? []).map(control => [control.id, control]))
  for (const control of after.controls ?? []) {
    const old = oldControls.get(control.id)
    if (!old) items.push({ text: `조정 항목 추가 · ${control.label}` })
    else if (!same(old, control)) items.push({ text: `조정 항목 변경 · ${control.label}`, note: old.value !== control.value ? `${controlValue(old)} → ${controlValue(control)}` : undefined })
    oldControls.delete(control.id)
  }
  for (const control of oldControls.values()) items.push({ text: `조정 항목 삭제 · ${control.label}` })
  if (before.title !== after.title) items.push({ text: '제목 변경', note: `${before.title} → ${after.title}` })
  if (before.width !== after.width || before.height !== after.height) items.push({ text: '화면 크기 변경', note: `${before.width}×${before.height} → ${after.width}×${after.height}` })
  if (before.fps !== after.fps) items.push({ text: '프레임 변경', note: `${before.fps}fps → ${after.fps}fps` })
  if (!same(before.style, after.style)) items.push({ text: '영상 스타일 변경' })
  return items
}

/** The scope line of an AI request: the whole video, one scene, or the marked moments of an output. */
function scopeText(scope, assets, scenes) {
  if (scope.kind === 'scene') {
    const scene = scenes[scope.index]
    return `장면 ${scope.index + 1}만 고쳐줘 (소재 ${nameById(assets, scene.asset)}, 자막 “${scene.caption}”, ${scene.seconds}초). 다른 장면의 순서·길이·자막은 바꾸지 마.`
  }
  if (scope.kind === 'markers') {
    return `사용자가 출력본에 표시한 구간만 고쳐줘. 표시한 구간 외에는 바꾸지 마.\n${scope.markers.map(marker => `  ${marker.n}) ${clock(marker.time)}${marker.scene ? `, 장면 ${marker.scene}` : ''}${marker.note ? `, 메모: ${marker.note}` : ''}`).join('\n')}`
  }
  return '전체 영상'
}

/** The message of a profile run: the request, its scope, and every source by name with its id and path. */
export function aiMessage({ brief, scope, assets, scenes, fileId, revision }) {
  const usage = usageOf(assets, scenes)
  const sources = assets.length ? assets.map(asset => `- ${assetName(assets, asset)}: id=${asset.id}, path=${asset.path ?? '(저장하면 정해져)'}, ${kindLabel(asset)}, ${usage.get(asset.id)}`).join('\n') : '(아직 없음)'
  return `HyperFrames 영상 제작 요청: ${brief}
범위: ${scopeText(scope, assets, scenes)}
이 영상의 소재 (요청의 ＠이름은 아래 소재를 가리켜. id는 project.assets의 id, path는 html에서 쓰는 경로야):
${sources}
현재 프로젝트 fileId=${fileId}, revision=${revision}. 먼저 p_hyperframes_guide와 p_hyperframes_read_project를 조회해. 요청에 필요한 새 소재는 내부 search_images로 이미지·영상을 검색하고 필요하면 search_images_by_tags 또는 search_images_by_meaning, search_files를 사용해. view_images/view_media_frames로 필요 장면을 확인해. 외부 URL·가짜 ID를 만들지 마. p_hyperframes_inspect_assets로 실제 원본을 연결해. 새 소재에는 짧은 label을 붙여. p_hyperframes_save_project에 현재 fileId와 최신 revision을 전달해 같은 프로젝트의 편집을 저장하고 저장된 fileId와 revision을 알려줘. 요청이 명시적으로 출력까지 요구하지 않으면 렌더하지 마. 원본 소재는 수정·삭제하지 마. 저장 제안이 대기 중이면 승인 필요 상태로 보고해.`
}
