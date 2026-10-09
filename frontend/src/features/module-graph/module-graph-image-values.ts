import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { uploadWorkflowInputImage } from '@/lib/api-module-graph'
import type { LibraryImageRef } from '@/lib/library-image-ref'
import type { ModuleGraphNode } from './module-graph-types'

/**
 * Images in node values and run inputs are library images referenced by id. A picked library image is pointed at
 * directly; an uploaded or edited one goes into the library ("워크플로 입력") first.
 */
export async function toWorkflowImageValue(image: SelectedImageDraft): Promise<LibraryImageRef> {
  if (image.compositeHash) return { composite_hash: image.compositeHash }
  return uploadWorkflowInputImage(image.dataUrl)
}

export type NodeImageReplacement = { nodeId: string; key: string; dataUrl: string; ref: LibraryImageRef }

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/')
}

/**
 * Graphs saved before kept images inline as data URLs. On save each one is moved into the library and replaced by
 * its ref; one that fails to upload stays inline so the save never loses it.
 */
export async function moveNodeImageDataUrlsToLibrary(nodes: ModuleGraphNode[]): Promise<NodeImageReplacement[]> {
  const uploads = new Map<string, Promise<LibraryImageRef | null>>()
  const upload = (dataUrl: string) => {
    let pending = uploads.get(dataUrl)
    if (!pending) {
      pending = uploadWorkflowInputImage(dataUrl).catch(() => null)
      uploads.set(dataUrl, pending)
    }
    return pending
  }

  const jobs = nodes.flatMap((node) => (node.data.module.exposed_inputs ?? [])
    .filter((port) => (port.data_type === 'image' || port.data_type === 'mask') && isImageDataUrl(node.data.inputValues?.[port.key]))
    .map(async (port) => {
      const dataUrl = node.data.inputValues?.[port.key] as string
      const ref = await upload(dataUrl)
      return ref ? { nodeId: node.id, key: port.key, dataUrl, ref } : null
    }))

  return (await Promise.all(jobs)).filter((replacement): replacement is NodeImageReplacement => replacement !== null)
}

/** Apply ref replacements to nodes whose value is still the data URL that was uploaded. */
export function applyNodeImageReplacements(nodes: ModuleGraphNode[], replacements: NodeImageReplacement[]) {
  if (replacements.length === 0) return nodes
  const byNode = new Map<string, NodeImageReplacement[]>()
  for (const replacement of replacements) {
    byNode.set(replacement.nodeId, [...(byNode.get(replacement.nodeId) ?? []), replacement])
  }
  return nodes.map((node) => {
    const nodeReplacements = byNode.get(node.id)
    if (!nodeReplacements) return node
    let inputValues = node.data.inputValues
    for (const { key, dataUrl, ref } of nodeReplacements) {
      if (inputValues?.[key] === dataUrl) inputValues = { ...inputValues, [key]: ref }
    }
    return inputValues === node.data.inputValues ? node : { ...node, data: { ...node.data, inputValues } }
  })
}
