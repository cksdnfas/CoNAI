import { useState } from 'react'
import { TextTabs } from '@/components/common/text-tabs'
import { useI18n } from '@/i18n'
import type { EditorEngine, EditorSnapshot } from '../engine/editor-engine'
import { AdjustPanel } from './adjust-panel'
import { LayerActions, LayerPanel } from './layer-panel'

type SideTab = 'layers' | 'adjust'

/** Right panel (and the phone sheet): 레이어 | 보정 tabs in place. Leaving 보정 keeps what was previewed. */
export function SidePanel({ engine, snapshot, onImportImage }: { engine: EditorEngine; snapshot: EditorSnapshot; onImportImage: () => void }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<SideTab>('layers')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 pr-2 pl-4">
        <TextTabs<SideTab>
        value={tab}
        items={[
          { value: 'layers', label: t({ ko: '레이어', en: 'Layers' }) },
          { value: 'adjust', label: t({ ko: '보정', en: 'Adjust' }) },
        ]}
        onChange={(next) => {
          if (next !== 'adjust') engine.commitAdjust()
          setTab(next)
        }}
        actions={tab === 'layers' ? <LayerActions engine={engine} snapshot={snapshot} onImportImage={onImportImage} /> : null}
        ariaLabel={t({ ko: '패널', en: 'Panel' })}
          className="h-11"
        />
      </div>
      {tab === 'layers' ? <LayerPanel engine={engine} snapshot={snapshot} /> : <AdjustPanel engine={engine} snapshot={snapshot} />}
    </div>
  )
}
