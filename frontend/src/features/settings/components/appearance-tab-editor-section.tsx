import { useState } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { AppearanceColorEditorContent } from './appearance-color-editor-content'
import { AppearanceGeneralEditorContent } from './appearance-general-editor-content'
import { AppearanceListEditorContent } from './appearance-list-editor-content'
import {
  APPEARANCE_EDITOR_TABS,
  type AppearanceEditorTab,
  type AppearanceTabEditorSectionProps,
} from './appearance-tab-editor-shared'

/** Render the tabbed appearance editor while delegating each tab to focused content components. */
export function AppearanceTabEditorSection(props: AppearanceTabEditorSectionProps) {
  const [activeTab, setActiveTab] = useState<AppearanceEditorTab>('general')

  return (
    <div className="space-y-6">
      <SegmentedTabBar
        value={activeTab}
        items={APPEARANCE_EDITOR_TABS}
        onChange={(nextTab) => setActiveTab(nextTab as AppearanceEditorTab)}
        size="xs"
        className="border-white/5"
      />

      {activeTab === 'general' ? <AppearanceGeneralEditorContent {...props} /> : null}
      {activeTab === 'list' ? <AppearanceListEditorContent {...props} /> : null}
      {activeTab === 'color' ? <AppearanceColorEditorContent {...props} /> : null}
    </div>
  )
}
