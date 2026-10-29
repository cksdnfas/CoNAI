import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookUser, Link2, Unlink } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { CharacterSettingPickerDialog } from '@/features/characters/components/character-setting-picker-dialog'
import { CharacterSettingSaveDialog } from '@/features/characters/components/character-setting-save-dialog'
import { useI18n } from '@/i18n'
import { characterSettingQueryKey, isCharacterRevisionConflict, type CharacterSetting } from '@/lib/api-character-library'
import { ChatEditorResolution, isChatRevisionConflict } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import type { CharacterLibraryStore, ProfileCharacterLink } from './use-profile-character-link'

/**
 * The appearance tab's library link: none (load a setting, or store this look as one), synced (where edits go and
 * how many profiles they reach) or detached (overwrite the origin, go back to it, or store a new setting).
 */
export function ChatProfileCharacterLinkBar({ link, profileName, dirty, busy, onBusyChange }: {
  link: ProfileCharacterLink
  profileName: string
  /** A dialog has unsaved edits and needs its own confirmation before opening the library. */
  dirty: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)
  const store = useMutation({
    mutationFn: (target: CharacterLibraryStore) => link.store(target),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => {
      setCreating(false)
      showSnackbar({ message: t({ ko: '라이브러리에 저장하고 동기화했어.', en: 'Stored in the library and synced.' }), tone: 'info' })
    },
    onError: (error) => {
      // A profile write conflict shares the 409 code; only the setting's own conflict reloads the origin.
      const settingConflict = isCharacterRevisionConflict(error) && !isChatRevisionConflict(error)
      if (settingConflict && link.link) void queryClient.invalidateQueries({ queryKey: characterSettingQueryKey(link.link.settingId) })
      showSnackbar({
        message: settingConflict
          ? t({ ko: '원본이 그사이 바뀌었어. 새로 불러왔으니 확인하고 다시 덮어써줘.', en: 'The origin changed meanwhile. It is reloaded; check it and overwrite again.' })
          : getErrorMessage(error, t({ ko: '라이브러리에 저장하지 못했어.', en: 'Could not store it in the library.' })),
        tone: error instanceof ChatEditorResolution ? 'info' : 'error',
      })
    },
  })
  const disabled = busy || store.isPending
  const label = link.label ?? '…'
  const count = link.linkedCount ?? 0

  const overwrite = async () => {
    const origin = link.origin
    if (!origin) return
    const names = link.otherSyncedProfiles.map((entry) => entry.name)
    const ok = await confirm({
      title: t({ ko: '원본에 덮어쓰기', en: 'Overwrite the origin' }),
      description: [
        t({ ko: '‘{label}’ 설정을 이 프로필의 지금 외형으로 덮어쓰고 다시 동기화할까?', en: 'Overwrite ‘{label}’ with this profile’s current look and sync to it again?' }, { label }),
        names.length
          ? t({ ko: '동기화 중인 프로필 {count}개도 함께 바뀌어: {names}', en: '{count} synced profiles change with it: {names}' }, { count: names.length, names: names.join(', ') })
          : t({ ko: '지금 이 설정과 동기화 중인 다른 프로필은 없어.', en: 'No other profile is synced to it now.' }),
      ].join('\n'),
      confirmLabel: t({ ko: '덮어쓰기', en: 'Overwrite' }),
      tone: 'destructive',
    })
    if (ok) store.mutate({ mode: 'overwrite' })
  }

  // Unsaved edits of the synced setting are not carried to another one, nor the profile's own look into a synced one.
  const loadPicked = async (picked: CharacterSetting) => {
    const dropsSetting = link.dirty && picked.id !== link.link?.settingId
    if ((dropsSetting || link.ownLookDirty) && !await confirm({
      title: t({ ko: '설정 불러오기', en: 'Load setting' }),
      description: dropsSetting
        ? t({ ko: '지금 설정에 저장 안 한 외형 변경이 있어. 다른 설정을 불러오면 그 변경은 사라져.', en: 'The current setting has unsaved look edits. Loading another setting drops them.' })
        : t({ ko: '이 프로필 외형에 저장 안 한 변경이 있어. 설정을 불러오면 그 변경은 사라져.', en: 'This profile’s look has unsaved edits. Loading a setting drops them.' }),
      confirmLabel: t({ ko: '불러오기', en: 'Load' }),
      tone: 'destructive',
    })) return
    link.load(picked)
  }

  // Opening the library leaves the editor: unsaved edits are dropped only after the usual question.
  const openInLibrary = async (settingId: number) => {
    if (dirty && !await confirm({
      title: t({ ko: '저장 안 한 변경이 있어', en: 'You have unsaved changes' }),
      confirmLabel: t({ ko: '버리기', en: 'Discard' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })) return
    navigate(`/characters?setting=${settingId}`)
  }

  const dialogs = <>
    <CharacterSettingPickerDialog
      open={picking}
      onOpenChange={setPicking}
      title={t({ ko: '불러올 외형 설정', en: 'Setting to load' })}
      confirmLabel={t({ ko: '불러오기', en: 'Load' })}
      initialFolderId={link.origin?.folderId ?? null}
      onPick={(picked) => void loadPicked(picked)}
    />
    {creating ? (
      <CharacterSettingSaveDialog
        title={t({ ko: '라이브러리에 저장', en: 'Store in the library' })}
        initialName={profileName}
        initialFolderId={link.origin?.folderId ?? null}
        busy={store.isPending}
        onSubmit={(target) => store.mutate({ mode: 'create', ...target })}
        onClose={() => setCreating(false)}
      />
    ) : null}
  </>

  if (!link.link) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <BookUser className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t({ ko: '캐릭터 라이브러리', en: 'Character library' })}</span>
        <span className="flex-1" />
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => setPicking(true)}>{t({ ko: '라이브러리에서 불러오기', en: 'Load from library' })}</Button>
        {link.canEdit ? <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setCreating(true)}>{t({ ko: '라이브러리에 저장', en: 'Store in library' })}</Button> : null}
        {dialogs}
      </div>
    )
  }

  const settingId = link.link.settingId
  const openButton = <Button type="button" size="sm" variant="ghost" onClick={() => void openInLibrary(settingId)}>{t({ ko: '라이브러리에서 열기', en: 'Open in library' })}</Button>
  if (link.synced) {
    return (
      <Alert variant="info" role="status">
        <Link2 />
        <AlertTitle>{t({ ko: '라이브러리와 동기화 중', en: 'Synced with the library' })}</AlertTitle>
        <AlertDescription>
          <p>{t({ ko: '‘{label}’ 설정과 동기화 중 · 이 설정을 쓰는 프로필 {count}개에 함께 반영돼', en: 'Synced with ‘{label}’ · edits reach all {count} profiles using this setting' }, { label, count })}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="secondary" disabled={disabled || !link.setting.ready} onClick={link.detach}>{t({ ko: '동기화 끊기', en: 'Stop syncing' })}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setPicking(true)}>{t({ ko: '다른 설정 불러오기', en: 'Load another setting' })}</Button>
            {openButton}
          </div>
        </AlertDescription>
        {dialogs}
      </Alert>
    )
  }
  return (
    <Alert role="status">
      <Unlink />
      <AlertTitle>{t({ ko: '동기화 끊김', en: 'Not synced' })}</AlertTitle>
      <AlertDescription>
        <p>{t({ ko: '동기화 끊김 · 원본 ‘{label}’', en: 'Not synced · origin ‘{label}’' }, { label })}</p>
        {link.originError ? <p className="text-destructive">{getErrorMessage(link.originError, t({ ko: '원본 외형 설정을 불러오지 못했어.', en: 'Could not load the origin setting.' }))}</p> : null}
        <div className="flex flex-wrap gap-1">
          {link.canEdit ? <Button type="button" size="sm" variant="secondary" disabled={disabled || !link.origin} onClick={() => void overwrite()}>{t({ ko: '원본에 덮어쓰기', en: 'Overwrite origin' })}</Button> : null}
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !link.origin} onClick={link.revert}>{t({ ko: '원본으로 되돌리기', en: 'Back to origin' })}</Button>
          {link.canEdit ? <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setCreating(true)}>{t({ ko: '새 설정으로 저장', en: 'Store as new setting' })}</Button> : null}
          {openButton}
        </div>
      </AlertDescription>
      {dialogs}
    </Alert>
  )
}
