import { connectPlugin } from './conai-plugin.js'

const $ = (id) => document.getElementById(id)
const status = $('status'), list = $('snippets'), text = $('text'), addButton = $('add')
let api, snippets = []

/** The screen's main prompt input: `prompt` when it has one, else its first text field. */
function promptField(form) {
  const fields = (form?.fields ?? []).filter((field) => field.type === 'text' && field.editable !== false && typeof field.value === 'string')
  return fields.find((field) => field.id === 'prompt') ?? fields.find((field) => /prompt/i.test(field.id)) ?? fields[0] ?? null
}

async function insert(snippet) {
  try {
    const field = promptField(await api.page.form())
    if (!field) { status.textContent = '이 화면에는 프롬프트 입력이 없어.'; return }
    const current = field.value.trim().replace(/,\s*$/, '')
    await api.page.fill({ [field.id]: current ? `${current}, ${snippet.text}` : snippet.text })
    status.textContent = `${field.label}에 넣었어.`
  } catch (error) {
    status.textContent = error.message
  }
}

function render() {
  list.replaceChildren(...snippets.map((snippet) => {
    const item = document.createElement('li')
    const use = document.createElement('button')
    use.type = 'button'; use.className = 'ghost use'; use.textContent = snippet.text; use.title = '프롬프트 끝에 넣기'
    use.onclick = () => insert(snippet)
    const remove = document.createElement('button')
    remove.type = 'button'; remove.className = 'ghost destructive'; remove.textContent = '지우기'
    remove.onclick = () => send({ op: 'remove', id: snippet.id })
    item.append(use, remove)
    return item
  }))
}

async function send(body) {
  try {
    snippets = (await api.server(body)).snippets
    render()
    return true
  } catch (error) {
    status.textContent = error.message
    return false
  }
}

async function showJobs() {
  try {
    const { jobs } = await api.server({ op: 'jobs' })
    const done = jobs.filter((job) => job.status === 'completed')
    const failed = jobs.filter((job) => job.status === 'failed').length
    status.textContent = jobs.length
      ? `최근 ${jobs.length}건 · 완료 ${done.length}건(이미지 ${done.reduce((sum, job) => sum + job.images, 0)}장)${failed ? ` · 실패 ${failed}건` : ''}`
      : '조각을 누르면 프롬프트 끝에 붙어.'
  } catch (error) {
    status.textContent = error.message
  }
}

// Sandboxed pages can't submit forms, so the button and Enter add directly.
const add = async () => { if (await send({ op: 'add', text: text.value })) text.value = '' }
addButton.addEventListener('click', add)
text.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) add() })

api = await connectPlugin({})
if (!api.context) status.textContent = '생성 화면의 블록으로 쓰는 페이지야.'
await send({ op: 'snippets' })
if (api.context) {
  await showJobs()
  api.events.on('queue.job.status', () => { void showJobs() })
}
