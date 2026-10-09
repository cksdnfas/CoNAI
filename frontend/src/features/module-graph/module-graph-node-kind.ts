import {
  AudioLines,
  BookOpen,
  Bot,
  Box,
  Braces,
  Film,
  Flag,
  GitBranch,
  Hash,
  Image as ImageIcon,
  Languages,
  MessageCircle,
  Puzzle,
  Scale,
  Search,
  Send,
  Sparkles,
  Tags,
  ToggleLeft,
  Type,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleDefinitionRecord, ModulePortDataType } from '@/lib/api-module-graph'
import { getModuleOperationKey, getPortTypeColor } from './module-graph-module-helpers'
import { getSystemModuleGroup, isCustomNodeModule, isGenerationModule } from './components/module-library-groups'

/** What a node does, as people pick it from the node menu: drives its header icon and color. */
export type ModuleNodeKind = 'input' | 'generation' | 'logic' | 'utility' | 'get' | 'llm' | 'output' | 'custom' | 'other'

export function getModuleNodeKind(module: ModuleDefinitionRecord): ModuleNodeKind {
  if (isCustomNodeModule(module)) return 'custom'
  if (module.engine_type !== 'system') return isGenerationModule(module) ? 'generation' : 'other'
  const group = getSystemModuleGroup(module).key
  return group === 'input' || group === 'generation' || group === 'logic' || group === 'utility' || group === 'get' || group === 'llm' || group === 'output'
    ? group
    : 'other'
}

const INPUT_TYPE_ICONS: Partial<Record<ModulePortDataType, LucideIcon>> = {
  image: ImageIcon,
  mask: ImageIcon,
  video: Film,
  audio: AudioLines,
  number: Hash,
  boolean: ToggleLeft,
  json: Braces,
}

const KIND_VISUALS: Record<Exclude<ModuleNodeKind, 'input'>, { icon: LucideIcon; color: string }> = {
  generation: { icon: Sparkles, color: 'var(--primary)' },
  logic: { icon: GitBranch, color: '#c084fc' },
  utility: { icon: Wrench, color: '#90a4ae' },
  get: { icon: Search, color: '#4fc3f7' },
  llm: { icon: Bot, color: '#7e9cff' },
  output: { icon: Flag, color: 'var(--warning)' },
  custom: { icon: Puzzle, color: '#ffb74d' },
  other: { icon: Box, color: '#b0bec5' },
}

/** Nodes that share a kind but do clearly different things get their own icon (the color stays the kind's). */
const OPERATION_ICONS: Readonly<Record<string, LucideIcon>> = {
  'system.translate_text': Languages,
  'system.judge_text': Scale,
  'system.chat_profile_reply': MessageCircle,
  'system.draft_appearance_tags': Tags,
  'system.load_chat_profile': UserRound,
  'system.search_lorebook': BookOpen,
  'system.post_to_chat_room': Send,
}

/** Header icon and color: input nodes take the type of the value they hold, the rest their kind. */
export function getModuleNodeKindVisual(module: ModuleDefinitionRecord): { kind: ModuleNodeKind; icon: LucideIcon; color: string } {
  const kind = getModuleNodeKind(module)
  if (kind === 'input') {
    const valueType = module.output_ports[0]?.data_type ?? 'text'
    return { kind, icon: INPUT_TYPE_ICONS[valueType] ?? Type, color: getPortTypeColor(valueType) }
  }
  const operationKey = getModuleOperationKey(module)
  const visual = KIND_VISUALS[kind]
  return { kind, color: visual.color, icon: (operationKey && OPERATION_ICONS[operationKey]) || visual.icon }
}
