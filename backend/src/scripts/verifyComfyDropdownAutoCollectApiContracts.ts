import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-dropdown-api-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

function sendJson(res: http.ServerResponse, value: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

function startModelApiServer() {
  const server = http.createServer((req, res) => {
    const pathname = req.url?.split('?')[0]

    if (pathname === '/models/checkpoints') {
      sendJson(res, [
        { name: 'Base.safetensors' },
        { name: 'Illustrious\\\\ub514\\ud14c\\uc77c\\AddMicroDetails_Illustrious_v3.safetensors' },
        { name: 'readme.txt' },
      ])
      return
    }

    if (pathname === '/models/diffusion_models') {
      sendJson(res, { data: [{ name: 'Flux/flux-dev.gguf' }] })
      return
    }

    if (pathname === '/models/unet_gguf') {
      sendJson(res, ['Q8/test-unet.gguf'])
      return
    }

    if (pathname === '/models/loras') {
      sendJson(res, { models: [{ filename: 'poses/pose_detail.safetensors' }] })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })

  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert.ok(address && typeof address === 'object')
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function main() {
  const { server, baseUrl } = await startModelApiServer()
  const publicWorkflowRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/public-workflows.routes.ts'), 'utf8')
  const { initializeUserSettingsDb, closeUserSettingsDb } = await import('../database/userSettingsDb')
  const { ComfyUIServerModel } = await import('../models/ComfyUIServer')
  const { CustomDropdownListModel } = await import('../models/CustomDropdownList')
  const {
    DEFAULT_COMFY_MODEL_API_PATHS,
    collectAndReplaceComfyModelDropdownListsFromDefaultServer,
    normalizeComfyModelOptionPath,
  } = await import('../services/comfyDropdownAutoCollectionService')

  initializeUserSettingsDb()

  try {
    assert.deepEqual(DEFAULT_COMFY_MODEL_API_PATHS, [
      '/models/checkpoints',
      '/models/diffusion_models',
      '/models/unet_gguf',
      '/models/loras',
    ])
    assert.equal(
      normalizeComfyModelOptionPath('Illustrious\\\\ub514\\ud14c\\uc77c\\AddMicroDetails_Illustrious_v3.safetensors'),
      'Illustrious\\디테일\\AddMicroDetails_Illustrious_v3.safetensors',
    )

    ComfyUIServerModel.create({
      name: 'Representative ComfyUI',
      endpoint: baseUrl,
      backend_type: 'comfyui',
      capacity: 1,
      is_default: true,
    })
    CustomDropdownListModel.create({
      name: 'legacy auto list',
      items: ['old.safetensors'],
      is_auto_collected: 1,
      source_path: 'client-selected',
    })
    CustomDropdownListModel.create({
      name: 'manual keep list',
      items: ['manual'],
    })

    const result = await collectAndReplaceComfyModelDropdownListsFromDefaultServer({
      apiPaths: DEFAULT_COMFY_MODEL_API_PATHS,
    })

    assert.equal(result.scannedFolders, 4)
    assert.equal(result.deletedLists, 1)
    assert.equal(result.createdLists, 9)

    const lists = CustomDropdownListModel.findAll()
    assert.equal(lists.some((list) => list.name === 'legacy auto list'), false)
    assert.equal(lists.some((list) => list.name === 'manual keep list'), true)

    const checkpointsMerged = lists.find((list) => list.name === 'checkpoints (통합)')
    assert.ok(checkpointsMerged)
    assert.deepEqual(checkpointsMerged.items, [
      'Base.safetensors',
      'Illustrious\\디테일\\AddMicroDetails_Illustrious_v3.safetensors',
    ])

    assert.match(
      publicWorkflowRoutesSource,
      /function resolveComfyModelPreviewFolder[\s\S]*AUTO_COLLECT_SOURCE_PATH[\s\S]*model_preview_folder: resolveComfyModelPreviewFolder\(dropdownList\)/,
      'public workflow responses should preserve Comfy model preview folders for auto-collected dropdown fields',
    )

    const lorasMerged = lists.find((list) => list.name === 'loras (통합)')
    assert.ok(lorasMerged)
    assert.deepEqual(lorasMerged.items, ['poses\\pose_detail.safetensors'])
    assert.ok(lists.some((list) => list.name === 'loras/poses'))

    console.log('✅ ComfyUI dropdown API auto-collect contracts passed')
  } finally {
    closeUserSettingsDb()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(runtimeBase, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
