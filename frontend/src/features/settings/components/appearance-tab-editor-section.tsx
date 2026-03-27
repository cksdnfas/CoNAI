import { useState } from 'react'
import { AppearanceColorEditorContent } from './appearance-color-editor-content'
import { AppearanceGeneralEditorContent } from './appearance-general-editor-content'
import { AppearanceListEditorContent } from './appearance-list-editor-content'
import {
  APPEARANCE_EDITOR_TABS,
  AppearanceEditorTabButton,
  type AppearanceEditorTab,
  type AppearanceTabEditorSectionProps,
} from './appearance-tab-editor-shared'

/** Render the tabbed appearance editor while delegating each tab to focused content components. */
export function AppearanceTabEditorSection(props: AppearanceTabEditorSectionProps) {
  const [activeTab, setActiveTab] = useState<AppearanceEditorTab>('general')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-2">
        {APPEARANCE_EDITOR_TABS.map((tab) => (
          <AppearanceEditorTabButton
            key={tab.value}
            label={tab.label}
            isActive={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
          />
        ))}
      </div>

      {activeTab === 'general' ? <AppearanceGeneralEditorContent {...props} /> : null}
      {activeTab === 'list' ? <AppearanceListEditorContent {...props} /> : null}
      {activeTab === 'color' ? <AppearanceColorEditorContent {...props} /> : null}
    </div>
  )
}
