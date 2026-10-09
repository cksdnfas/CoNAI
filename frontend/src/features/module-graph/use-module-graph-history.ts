import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-shared'

const HISTORY_LIMIT = 100
/** Changes closer together than this become one step (typing a value, a burst of moves). */
const HISTORY_SETTLE_MS = 400

type HistoryNode = Pick<ModuleGraphNode, 'id' | 'type' | 'position'> & {
  data: Pick<ModuleGraphNode['data'], 'module' | 'label' | 'disabled' | 'inputValues'>
}

type HistorySnapshot = {
  nodes: HistoryNode[]
  edges: ModuleGraphEdge[]
}

/** Keep only what the user edits; run status, previews and connection caches are derived again after a restore. */
function takeSnapshot(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]): HistorySnapshot {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        module: node.data.module,
        label: node.data.label,
        disabled: node.data.disabled,
        inputValues: node.data.inputValues,
      },
    })),
    edges: edges.map((edge) => ({ ...edge, selected: false })),
  }
}

/** State updates replace changed objects, so comparing references finds every edit without serializing the graph. */
function isSameSnapshot(left: HistorySnapshot, right: HistorySnapshot) {
  if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) {
    return false
  }

  for (let index = 0; index < left.nodes.length; index += 1) {
    const a = left.nodes[index]
    const b = right.nodes[index]
    if (
      a.id !== b.id
      || a.position.x !== b.position.x
      || a.position.y !== b.position.y
      || a.data.module !== b.data.module
      || a.data.label !== b.data.label
      || a.data.disabled !== b.data.disabled
      || a.data.inputValues !== b.data.inputValues
    ) {
      return false
    }
  }

  for (let index = 0; index < left.edges.length; index += 1) {
    const a = left.edges[index]
    const b = right.edges[index]
    if (a.id !== b.id || a.source !== b.source || a.target !== b.target || a.sourceHandle !== b.sourceHandle || a.targetHandle !== b.targetHandle) {
      return false
    }
  }

  return true
}

/**
 * Undo / redo for the node editor. Every edit is recorded on its own (connect, delete, move, values, paste, layout,
 * assistant edits): the graph is watched and each settled change becomes one step. `resetKey` changes when another
 * workflow or a fresh draft is loaded, which starts an empty history.
 */
export function useModuleGraphHistory({
  nodes,
  edges,
  setNodes,
  setEdges,
  resetKey,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  setNodes: Dispatch<SetStateAction<ModuleGraphNode[]>>
  setEdges: Dispatch<SetStateAction<ModuleGraphEdge[]>>
  resetKey: string | number
}) {
  const pastRef = useRef<HistorySnapshot[]>([])
  const futureRef = useRef<HistorySnapshot[]>([])
  const stableRef = useRef<HistorySnapshot | null>(null)
  const latestRef = useRef<HistorySnapshot>(takeSnapshot(nodes, edges))
  const settleTimerRef = useRef<number | null>(null)
  const restoringRef = useRef<HistorySnapshot | null>(null)
  const [counts, setCounts] = useState({ past: 0, future: 0 })
  const [pending, setPending] = useState(false)

  const syncCounts = useCallback(() => {
    setCounts((current) => (
      current.past === pastRef.current.length && current.future === futureRef.current.length
        ? current
        : { past: pastRef.current.length, future: futureRef.current.length }
    ))
  }, [])

  const clearSettleTimer = () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }

  /** Turn the latest graph into the new stable state, pushing the previous one as an undo step. */
  const commit = useCallback(() => {
    clearSettleTimer()
    setPending(false)
    const latest = latestRef.current
    const stable = stableRef.current
    if (!stable) {
      stableRef.current = latest
      return
    }
    if (isSameSnapshot(stable, latest)) {
      return
    }
    pastRef.current = [...pastRef.current, stable].slice(-HISTORY_LIMIT)
    futureRef.current = []
    stableRef.current = latest
    syncCounts()
  }, [syncCounts])

  useEffect(() => {
    clearSettleTimer()
    pastRef.current = []
    futureRef.current = []
    // The graph that arrives with the reset (or right after it) is the starting point, not a step.
    stableRef.current = null
    restoringRef.current = null
    syncCounts()
    setPending(false)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      stableRef.current = latestRef.current
    }, HISTORY_SETTLE_MS)
    return clearSettleTimer
  }, [resetKey, syncCounts])

  useEffect(() => {
    const snapshot = takeSnapshot(nodes, edges)
    latestRef.current = snapshot

    // The first graph after an undo / redo is the restored state itself.
    if (restoringRef.current) {
      restoringRef.current = null
      stableRef.current = snapshot
      return
    }

    if (!stableRef.current || isSameSnapshot(stableRef.current, snapshot)) {
      return
    }

    // A node drag reports every frame; record the move once the pointer lets go.
    if (nodes.some((node) => node.dragging)) {
      clearSettleTimer()
      return
    }

    clearSettleTimer()
    setPending(true)
    settleTimerRef.current = window.setTimeout(commit, HISTORY_SETTLE_MS)
  }, [commit, edges, nodes])

  const restore = useCallback((snapshot: HistorySnapshot) => {
    restoringRef.current = snapshot
    stableRef.current = snapshot
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]))
      return snapshot.nodes.map((entry) => {
        const current = currentById.get(entry.id)
        return {
          ...(current ?? {}),
          id: entry.id,
          type: entry.type,
          position: entry.position,
          selected: current?.selected ?? false,
          data: { ...(current?.data ?? {}), ...entry.data },
        } as ModuleGraphNode
      })
    })
    setEdges(snapshot.edges)
  }, [setEdges, setNodes])

  const undo = useCallback(() => {
    // An edit still settling counts as the newest step.
    if (settleTimerRef.current !== null) {
      commit()
    }
    const previous = pastRef.current.at(-1)
    const stable = stableRef.current
    if (!previous || !stable) {
      return false
    }
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, stable]
    syncCounts()
    restore(previous)
    return true
  }, [commit, restore, syncCounts])

  const redo = useCallback(() => {
    if (settleTimerRef.current !== null) {
      commit()
    }
    const next = futureRef.current.at(-1)
    const stable = stableRef.current
    if (!next || !stable) {
      return false
    }
    futureRef.current = futureRef.current.slice(0, -1)
    pastRef.current = [...pastRef.current, stable].slice(-HISTORY_LIMIT)
    syncCounts()
    restore(next)
    return true
  }, [commit, restore, syncCounts])

  return {
    undo,
    redo,
    canUndo: counts.past > 0 || pending,
    canRedo: counts.future > 0,
  }
}
