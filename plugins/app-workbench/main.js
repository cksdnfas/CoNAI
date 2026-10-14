import { connectPlugin } from './conai-plugin.js'
const $ = id => document.getElementById(id)
let revision = 0
let formVersion = 0, submittedVersion = 0
const api = await connectPlugin()
function publish() {
  api.publish({ revision: String(++revision), dirty: formVersion !== submittedVersion, data: { lastResult: $('result').textContent.slice(0, 2000), form: { groupName: $('group-name').value, title: $('post-title').value, body: $('post-body').value.slice(0, 2000), target: $('document-target').value } } })
}
function show(result) {
  $('result').textContent = JSON.stringify(result, null, 2)
  $('status').textContent = result.status === 'pending' ? '앱 검토 카드에서 대상과 입력을 확인하고 적용해줘.' : '처리 결과를 확인해줘.'
  publish()
}
async function run(task, submit = false) {
  const version = formVersion
  try { $('status').textContent = '처리 중…'; const result = await task(); if (submit && result.status === 'pending') submittedVersion = version; show(result) }
  catch (error) { $('status').textContent = error.message || String(error) }
}
for (const action of ['groups', 'workflows', 'audio']) $(action).onclick = () => run(() => api.app.run(`app-workbench.${action}`))
$('tools').onclick = () => run(() => api.app.tools())
$('create-group').onclick = () => run(() => api.app.run('app-workbench.create_group', { name: $('group-name').value }), true)
$('write-note').onclick = () => run(() => api.app.run('app-workbench.write_note', { title: $('post-title').value, body: $('post-body').value }), true)
$('project-files').onclick = () => run(() => api.app.run('app-workbench.project_files'))
$('project-note').onclick = () => run(() => api.app.run('app-workbench.project_note', { target: $('document-target').value, text: $('post-body').value }), true)
api.onSaved(({ result }) => show({ status: 'completed', result }))
$('status').textContent = '앱에 연결했어.'
for (const id of ['group-name', 'post-title', 'post-body', 'document-target']) $(id).oninput = () => { formVersion++; publish() }
publish()
