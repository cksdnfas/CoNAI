import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings, updateGeneralSettings } from '@/lib/api-settings-general'
import { useI18n } from '@/i18n'
import {
  clearLegacySecurityGroupColorMap,
  normalizeSecurityGroupColorMap,
  readLegacySecurityGroupColorMap,
  type SecurityGroupColorMap,
} from './security-group-color-utils'

type AppSettingsRecord = Awaited<ReturnType<typeof getAppSettings>>

/** Colour pickers fire on every drag step, so wait for a pause before writing to the server. */
const SAVE_DEBOUNCE_MS = 500

/**
 * Permission-group badge colours, stored server-side in general settings so every admin browser agrees.
 * Edits show immediately and are saved after a short pause (instant apply, no save bar).
 */
export function useSecurityGroupColors() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const settingsQuery = useQuery({ queryKey: ['app-settings'], queryFn: getAppSettings })
  // Raw editor values (may hold half-typed text) until the next server round trip settles.
  const [localColors, setLocalColors] = useState<SecurityGroupColorMap | null>(null)
  const pendingRef = useRef<SecurityGroupColorMap | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasMigratedLegacyRef = useRef(false)
  const serverColors = normalizeSecurityGroupColorMap(settingsQuery.data?.general.permissionGroupColors)

  const saveMutation = useMutation({
    mutationFn: (colors: SecurityGroupColorMap) => updateGeneralSettings({ permissionGroupColors: colors }),
    onMutate: (colors) => {
      // Show the new colours right away; the server answer (or a refetch on error) settles it.
      queryClient.setQueryData<AppSettingsRecord>(['app-settings'], (current) => (
        current ? { ...current, general: { ...current.general, permissionGroupColors: colors } } : current
      ))
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['app-settings'], settings)
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['app-settings'] })
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '그룹 색상을 저장하지 못했어.', en: 'Could not save the group colors.' }),
        tone: 'error',
      })
    },
  })
  const { mutate: saveColors } = saveMutation

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) {
      saveColors(normalizeSecurityGroupColorMap(pending))
    }
  }, [saveColors])

  // Save whatever is still waiting when the section unmounts (tab switch, leaving the page).
  useEffect(() => flush, [flush])

  // One-time move of colours chosen before they were stored on the server.
  useEffect(() => {
    if (hasMigratedLegacyRef.current || !settingsQuery.data) {
      return
    }

    hasMigratedLegacyRef.current = true
    const legacyColors = readLegacySecurityGroupColorMap()
    if (Object.keys(legacyColors).length === 0) {
      return
    }

    const currentColors = normalizeSecurityGroupColorMap(settingsQuery.data.general.permissionGroupColors)
    if (Object.keys(currentColors).length === 0) {
      saveColors(legacyColors, { onSuccess: clearLegacySecurityGroupColorMap })
      return
    }

    clearLegacySecurityGroupColorMap()
  }, [saveColors, settingsQuery.data])

  const update = (updater: (current: SecurityGroupColorMap) => SecurityGroupColorMap) => {
    const next = updater(localColors ?? serverColors)
    setLocalColors(next)
    pendingRef.current = next
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
  }

  return {
    groupColors: localColors ?? serverColors,
    setGroupColor: (groupKey: string, color: string) => update((current) => ({ ...current, [groupKey]: color })),
    resetGroupColor: (groupKey: string) => update((current) => {
      const next = { ...current }
      delete next[groupKey]
      return next
    }),
    /** Send any pending edit now and fall back to the saved colours (drops half-typed values). */
    commit: () => {
      flush()
      setLocalColors(null)
    },
  }
}
