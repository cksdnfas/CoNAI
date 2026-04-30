import { CircleHelp } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { TranslationDictionary } from '@/i18n/resources/types'
import type { ModulePortDefinition } from '@/lib/api'

const MODULE_GRAPH_PORT_TYPE_LABELS: Record<ModulePortDefinition['data_type'], TranslationDictionary> = {
  image: { ko: '이미지', en: 'Image' },
  mask: { ko: '마스크', en: 'Mask' },
  prompt: { ko: '프롬프트', en: 'Prompt' },
  text: { ko: '텍스트', en: 'Text' },
  number: { ko: '숫자', en: 'Number' },
  boolean: { ko: '불리언', en: 'Boolean' },
  json: { ko: 'JSON', en: 'JSON' },
  any: { ko: '임의', en: 'Any' },
}

/** Check whether one inline value should count as user-provided content. */
export function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Resolve one user-facing label for a module port data type. */
export function getModuleGraphPortTypeLabel(t: ReturnType<typeof useI18n>['t'], dataType: ModulePortDefinition['data_type']) {
  return t(MODULE_GRAPH_PORT_TYPE_LABELS[dataType])
}

/** Render a compact tooltip icon for internal node, edge, and port references. */
export function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}
