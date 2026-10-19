import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWildcards } from '@/lib/api-wildcards'
import { flattenWildcardRecords } from './wildcard-inline-picker-helpers'

interface UseWildcardInlinePickerDataOptions {
  enabled: boolean
}

export function useWildcardInlinePickerData({ enabled }: UseWildcardInlinePickerDataOptions) {
  const { canViewWildcards } = useFeaturePermissions()
  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'inline-picker'],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
    enabled: enabled && canViewWildcards,
    staleTime: 60_000,
  })

  const wildcards = useMemo(() => canViewWildcards ? wildcardsQuery.data ?? [] : [], [canViewWildcards, wildcardsQuery.data])
  const flattenedWildcards = useMemo(() => flattenWildcardRecords(wildcards), [wildcards])

  return {
    wildcardsQuery,
    flattenedWildcards,
  }
}
