import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  loadRuntimeArtifactsByNode,
  shouldMaterializeRuntimeArtifactValue,
} from '../services/graph-workflow-executor/artifacts'
import type {
  ExecutionContext,
  ParsedModuleDefinition,
} from '../services/graph-workflow-executor/shared'
import type { GraphExecutionArtifactRecord } from '../types/moduleGraph'

const ISO = '2026-05-12T00:00:00.000Z'

function moduleDefinition(overrides: Partial<ParsedModuleDefinition> & Pick<ParsedModuleDefinition, 'id' | 'engine_type'>): ParsedModuleDefinition {
  return {
    id: overrides.id,
    name: overrides.name ?? `module-${overrides.id}`,
    engine_type: overrides.engine_type,
    authoring_source: overrides.authoring_source ?? 'manual',
    template_defaults: overrides.template_defaults ?? {},
    exposed_inputs: overrides.exposed_inputs ?? [],
    output_ports: overrides.output_ports ?? [],
    internal_fixed_values: overrides.internal_fixed_values ?? {},
    ui_schema: overrides.ui_schema ?? [],
    category: overrides.category ?? null,
    description: overrides.description ?? null,
    source_workflow_id: overrides.source_workflow_id ?? null,
    version: overrides.version ?? 1,
    is_active: overrides.is_active ?? true,
    created_date: overrides.created_date ?? ISO,
    updated_date: overrides.updated_date ?? ISO,
  }
}

function buildContext(targetModule: ParsedModuleDefinition): ExecutionContext {
  return {
    executionId: 1,
    debugMode: false,
    artifactsByNode: new Map(),
    modulesById: new Map([[targetModule.id, targetModule]]),
    workflow: {
      id: 1,
      name: 'artifact-runtime-smoke',
      version: 1,
      graph: {
        nodes: [
          { id: 'source', module_id: 100, position: { x: 0, y: 0 } },
          { id: 'target', module_id: targetModule.id, position: { x: 1, y: 0 } },
        ],
        edges: [
          {
            id: 'edge-1',
            source_node_id: 'source',
            source_port_key: 'output',
            target_node_id: 'target',
            target_port_key: 'input',
          },
        ],
      },
    },
  }
}

function artifactRecord(overrides: Partial<GraphExecutionArtifactRecord> & Pick<GraphExecutionArtifactRecord, 'id' | 'artifact_type' | 'storage_path'>): GraphExecutionArtifactRecord {
  return {
    id: overrides.id,
    execution_id: overrides.execution_id ?? 1,
    node_id: overrides.node_id ?? 'source',
    port_key: overrides.port_key ?? 'output',
    artifact_type: overrides.artifact_type,
    storage_path: overrides.storage_path,
    metadata: overrides.metadata ?? null,
    created_date: overrides.created_date ?? ISO,
  }
}

async function main() {
  const finalResultContext = buildContext(moduleDefinition({
    id: 1,
    engine_type: 'system',
    internal_fixed_values: { operation_key: 'system.final_result' },
  }))
  assert.equal(
    shouldMaterializeRuntimeArtifactValue(finalResultContext, 'source', 'output', 'file'),
    false,
    'final-result nodes should keep file/video artifacts as previewable file references',
  )

  const comfyImageContext = buildContext(moduleDefinition({
    id: 2,
    engine_type: 'comfyui',
    exposed_inputs: [{ key: 'input', label: 'Input', data_type: 'image', direction: 'input', required: false }],
  }))
  assert.equal(
    shouldMaterializeRuntimeArtifactValue(comfyImageContext, 'source', 'output', 'image'),
    false,
    'ComfyUI image inputs should receive file references instead of forced inline data URLs',
  )

  const systemJsonContext = buildContext(moduleDefinition({
    id: 3,
    engine_type: 'system',
    exposed_inputs: [{ key: 'input', label: 'Input', data_type: 'json', direction: 'input', required: false }],
  }))
  assert.equal(
    shouldMaterializeRuntimeArtifactValue(systemJsonContext, 'source', 'output', 'file'),
    true,
    'non-file-reference consumers should still force binary artifacts to materialize inline',
  )

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conai-graph-artifact-runtime-'))
  const videoPath = path.join(tempDir, 'preview.webm')
  await fs.writeFile(videoPath, Buffer.from('fake-video'))

  try {
    const loaded = await loadRuntimeArtifactsByNode([
      artifactRecord({
        id: 10,
        artifact_type: 'file',
        storage_path: videoPath,
        metadata: JSON.stringify({
          mimeType: 'video/webm',
          originalFileName: 'original-output.webm',
          compositeHash: 'hash:legacy',
          actual_composite_hash: 'hash:actual',
        }),
      }),
    ])

    assert.ok(loaded)
    assert.deepEqual(loaded.output.value, {
      storagePath: videoPath,
      fileName: 'preview.webm',
      mimeType: 'video/webm',
      originalFileName: 'original-output.webm',
      compositeHash: 'hash:actual',
    })
    assert.equal(loaded.output.type, 'file')
    assert.equal(loaded.output.storagePath, videoPath)

    const missing = await loadRuntimeArtifactsByNode([
      artifactRecord({
        id: 11,
        artifact_type: 'file',
        storage_path: path.join(tempDir, 'missing.mp4'),
        metadata: JSON.stringify({ mimeType: 'video/mp4' }),
      }),
    ])
    assert.equal(missing, null, 'reused nodes should not hydrate stale artifact file references')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  console.log('✅ Graph artifact runtime smoke passed (materialization, file references, hydration)')
}

main()
