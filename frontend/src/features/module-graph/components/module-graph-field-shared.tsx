import { CircleHelp } from 'lucide-react'
import type { ModulePortDefinition } from '@/lib/api'

const MODULE_GRAPH_PORT_TYPE_LABELS: Record<ModulePortDefinition['data_type'], string> = {
  image: '이미지',
  mask: '마스크',
  prompt: '프롬프트',
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  json: 'JSON',
  any: '임의',
}

/** Check whether one inline value should count as user-provided content. */
export function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Resolve one user-facing label for a module port data type. */
export function getModuleGraphPortTypeLabel(dataType: ModulePortDefinition['data_type']) {
  return MODULE_GRAPH_PORT_TYPE_LABELS[dataType]
}

/** Render a compact tooltip icon for internal node, edge, and port references. */
export function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}
