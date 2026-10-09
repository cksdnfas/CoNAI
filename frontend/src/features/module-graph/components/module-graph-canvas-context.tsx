import { createContext, useContext } from 'react'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type { ModulePortDataType } from '@/lib/api-module-graph'

/** The port a link is being dragged from. */
export type ModuleGraphConnectionDrag = {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
  dataType: ModulePortDataType | null
}

/** A link lifted off an input. Both ends keep their "linked" layout until the drop so rows do not jump under the pointer. */
export type ModuleGraphLiftedLink = {
  sourceNodeId: string
  sourcePortKey: string
  targetNodeId: string
  targetPortKey: string
  sourceLabel: string
}

export type ModuleGraphCanvasContextValue = {
  /** Set while a link is being dragged; ports light up or dim by whether they can take it. */
  drag: ModuleGraphConnectionDrag | null
  /** The port a drop on the hovered node body would connect to. */
  dropTarget: { nodeId: string; handleId: string } | null
  /** Lift the link plugged into one input so it can be dropped somewhere else (mouse only). */
  pickUpInput: (nodeId: string, handleId: string, point: { x: number; y: number }) => void
  canPickUp: boolean
  /** Run order numbers and the cache badge only show in debug mode. */
  debugMode: boolean
  /** "nodeId␀portKey" → label of the node feeding that input. */
  inputSources: ReadonlyMap<string, string>
  liftedLink: ModuleGraphLiftedLink | null
}

const NOOP_CANVAS_CONTEXT: ModuleGraphCanvasContextValue = {
  drag: null,
  dropTarget: null,
  pickUpInput: () => {},
  canPickUp: false,
  debugMode: false,
  inputSources: new Map(),
  liftedLink: null,
}

export const ModuleGraphCanvasContext = createContext<ModuleGraphCanvasContextValue>(NOOP_CANVAS_CONTEXT)

export function useModuleGraphCanvasContext() {
  return useContext(ModuleGraphCanvasContext)
}

export function buildInputSourceKey(nodeId: string, portKey: string) {
  return `${nodeId}\u0000${portKey}`
}

/** What a node card can do to the graph. The object stays the same across renders, so cards only redraw for their own data. */
export type ModuleGraphNodeActions = {
  changeValue: (nodeId: string, key: string, value: unknown) => void
  clearValue: (nodeId: string, key: string) => void
  changeLabel: (nodeId: string, label: string) => void
  changeImage: (nodeId: string, key: string, image?: SelectedImageDraft) => void
  execute: (nodeId: string, force: boolean) => void
  duplicate: (nodeId: string) => void
  toggleDisabled: (nodeId: string) => void
  remove: (nodeId: string) => void
  /** Open the node's quick menu (the same one right-click shows) under the given screen point. */
  openMenu: (nodeId: string, anchor: { x: number; y: number }) => void
  /** Select the node and show its panel, focusing one field when given. */
  editInPanel: (nodeId: string, key?: string) => void
}

const NOOP_ACTIONS: ModuleGraphNodeActions = {
  changeValue: () => {},
  clearValue: () => {},
  changeLabel: () => {},
  changeImage: () => {},
  execute: () => {},
  duplicate: () => {},
  toggleDisabled: () => {},
  remove: () => {},
  openMenu: () => {},
  editInPanel: () => {},
}

export const ModuleGraphNodeActionsContext = createContext<ModuleGraphNodeActions>(NOOP_ACTIONS)

export function useModuleGraphNodeActions() {
  return useContext(ModuleGraphNodeActionsContext)
}

/** Whether running from a node is blocked right now (a run is already going). */
export const ModuleGraphExecutionLockContext = createContext(false)

export function useModuleGraphExecutionLock() {
  return useContext(ModuleGraphExecutionLockContext)
}
