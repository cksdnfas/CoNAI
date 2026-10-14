import { connectPlugin } from './conai-plugin.js'

const editor = document.querySelector('#editor'), files = document.querySelector('#files'), status = document.querySelector('#status')
const comparison = document.querySelector('#comparison'), latestText = document.querySelector('#latest')
let api, current, original = '', serial = 0, selection = 0
const pendingProposals = new Map()
const dirty = () => current && editor.value !== original
function publish() {
  api.publish(() => ({ revision: String(++serial), dirty: !!dirty(), data: { files: api.files.map(({ id, name }) => ({ id, name })), selected: current ? { id: current.id, name: current.name, excerpt: editor.value.slice(0, 8000), truncated: editor.value.length > 8000, ...(!comparison.hidden ? { latestExcerpt: original.slice(0, 8000), latestTruncated: original.length > 8000 } : {}) } : null } }))
}
async function select(id) {
  if (dirty()) throw new Error('미저장 초안이 있어. 저장하거나 초안을 버려줘.')
  if (!api.files.some((file) => file.id === id)) throw new Error('연결된 파일만 열 수 있어.')
  editor.disabled = true
  const request = ++selection
  try {
    const loaded = await api.request('files.readText', { fileId: id })
    if (request !== selection) return
    current = loaded; original = loaded.text; editor.value = loaded.text; files.value = id
    comparison.hidden = true
    status.textContent = loaded.name; publish()
  } finally { if (request === selection) editor.disabled = !current }
}
async function refresh() {
  if (!current || editor.disabled) throw new Error('문서를 먼저 열어줘.')
  const fileId = current.id, request = ++selection
  const latest = await api.request('files.readText', { fileId })
  if (request !== selection || current?.id !== fileId) return
  // Check dirty AFTER the await: typing while the read is in flight must also be preserved.
  const keepDraft = dirty()
  current = latest; original = latest.text
  if (!keepDraft) editor.value = latest.text
  latestText.value = latest.text; comparison.hidden = false; comparison.open = true
  publish(); status.textContent = '최신 원본을 불러왔어. 초안과 비교한 뒤 저장 검토를 다시 요청해줘.'
}
function format() { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2) + '\n'; publish() }
async function propose() {
  if (!current) throw new Error('문서를 먼저 열어줘.')
  const fileId = current.id
  const result = await api.request('files.proposeWrite', { fileId, revision: current.revision, text: editor.value })
  pendingProposals.set(result.proposalId, fileId)
  if (pendingProposals.size > 4) pendingProposals.delete(pendingProposals.keys().next().value)
  status.textContent = '앱 아래쪽의 검토 카드에서 내용을 확인하고 적용해줘.'
}
function showError(error) { status.textContent = error instanceof Error ? error.message : String(error) }
api = await connectPlugin({
  'text-editor.select': ({ id }) => select(id),
  'text-editor.refresh': () => refresh(),
  'text-editor.format': () => format(),
  'text-editor.replace': ({ before, after }) => {
    if (!before || editor.value.split(before).length !== 2) throw new Error('문구가 정확히 한 곳에 일치해야 해.')
    editor.value = editor.value.replace(before, () => after); publish()
  },
  'text-editor.propose': () => propose(),
})
for (const file of api.files) { const option = document.createElement('option'); option.value = file.id; option.textContent = file.name; files.append(option) }
files.addEventListener('change', () => { const target = files.value; files.value = current?.id ?? ''; void select(target).catch(showError) })
editor.addEventListener('input', () => { status.textContent = dirty() ? '미저장 초안' : current?.name ?? ''; publish() })
document.querySelector('#format').addEventListener('click', () => { try { format() } catch (error) { showError(error) } })
document.querySelector('#refresh').addEventListener('click', () => { void refresh().catch(showError) })
document.querySelector('#save').addEventListener('click', () => { void propose().catch(showError) })
document.querySelector('#revert').addEventListener('click', () => { editor.value = original; publish(); status.textContent = '초안을 버렸어.' })
api.onSaved(async ({ proposalId }) => {
  const fileId = pendingProposals.get(proposalId)
  pendingProposals.delete(proposalId)
  if (!fileId || current?.id !== fileId) return
  const request = selection
  try {
    const latest = await api.request('files.readText', { fileId })
    if (request !== selection) return
    latestText.value = latest.text
    current = latest; original = latest.text; publish(); status.textContent = dirty() ? '저장했어. 이후 수정한 초안은 남아 있어.' : '저장했어.'
  } catch (error) { showError(error) }
})
if (api.files[0]) await select(api.files[0].id).catch(showError)
else status.textContent = '파일을 연결해줘.'
