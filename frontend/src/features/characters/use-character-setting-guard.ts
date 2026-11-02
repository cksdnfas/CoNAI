import { useCallback } from 'react'
import type { Location } from 'react-router-dom'
import { useEditorPageGuard } from '@/features/settings/use-unsaved-settings-guard'
import { useI18n } from '@/i18n'
import type { CharacterSettingEditorState } from './use-character-setting-editor'

function leavesSetting(current: Location, next: Location) {
  if (current.pathname !== next.pathname) return true
  const before = new URLSearchParams(current.search)
  const after = new URLSearchParams(next.search)
  return before.get('setting') !== after.get('setting') || before.get('new') !== after.get('new')
}

/** The panel and full editor share one draft and one guard; expanding never discards edits. */
export function useCharacterSettingGuard(editor: CharacterSettingEditorState, canEdit: boolean) {
  const { t } = useI18n()
  const { baseRef, deletedRef } = editor
  const allowLeave = useCallback((current: Location, next: Location) => {
    if (current.pathname !== next.pathname) return false
    const before = new URLSearchParams(current.search)
    const after = new URLSearchParams(next.search)
    return (deletedRef.current && !after.has('setting') && !after.has('new'))
      || (before.has('new') && after.get('setting') === String(baseRef.current?.id) && before.get('view') === after.get('view'))
  }, [baseRef, deletedRef])
  useEditorPageGuard(canEdit && editor.dirty, t({ ko: '외형 설정에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This appearance setting has unsaved changes that will be lost.' }), leavesSetting, allowLeave)
}
