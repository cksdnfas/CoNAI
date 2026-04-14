import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  addAuthPermissionGroupMember,
  createAuthPermissionGroup,
  deleteAuthPermissionGroup,
  getAuthDatabaseInfo,
  getAuthPermissionGroupDetail,
  getPageAccessMatrix,
  listAuthAccounts,
  listAuthPermissionGroups,
  listPermissionGroups,
  removeAuthPermissionGroupMember,
  setupLocalAccount,
  updateAuthAccountSystemGroup,
  updateAuthPermissionGroup,
  updateBuiltInPageAccess,
  updateLocalAccount,
} from '@/lib/api'
import type {
  AuthMutationRecord,
  AuthPermissionGroupDetailRecord,
  AuthPermissionGroupMemberItem,
  AuthPermissionGroupSummaryItem,
  AuthStatusRecord,
  PageAccessMatrixRecord,
} from '@/lib/api-auth'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

const AUTH_ACCOUNTS_QUERY_KEY = ['auth-accounts'] as const
const AUTH_PERMISSION_GROUPS_QUERY_KEY = ['auth-permission-groups', 'all'] as const
const AUTH_PAGE_ACCESS_QUERY_KEY = ['auth-page-access'] as const

type SetupDraft = {
  username: string
  password: string
}

type UpdateDraft = {
  currentPassword: string
  nextUsername: string
  nextPassword: string
}

type PermissionGroupEditorMode = 'create' | 'edit' | null

type PermissionGroupEditorDraft = {
  name: string
  description: string
  permissionKeys: string[]
}

/** Build the cached auth-status payload after one successful admin auth mutation. */
function buildCachedAdminAuthStatus(result: AuthMutationRecord, fallbackStatus: AuthStatusRecord | null, fallbackUsername: string): AuthStatusRecord {
  return {
    hasCredentials: true,
    authenticated: true,
    username: result.username ?? fallbackUsername,
    accountId: result.accountId ?? fallbackStatus?.accountId ?? null,
    accountType: result.accountType ?? fallbackStatus?.accountType ?? 'admin',
    isAdmin: result.isAdmin ?? fallbackStatus?.isAdmin ?? true,
    groupKeys: result.groupKeys ?? fallbackStatus?.groupKeys ?? ['admin'],
    permissionKeys: result.permissionKeys ?? fallbackStatus?.permissionKeys ?? [],
  }
}

/** Build the empty permission-group editor draft. */
function createEmptyPermissionGroupDraft(): PermissionGroupEditorDraft {
  return {
    name: '',
    description: '',
    permissionKeys: [],
  }
}

/** Own the auth/account-management queries, drafts, and mutations for the security tab. */
export function useSecurityTabData() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const databaseInfoQuery = useQuery({
    queryKey: ['auth-database-info'],
    queryFn: getAuthDatabaseInfo,
    staleTime: 60_000,
  })

  const [setupDraft, setSetupDraft] = useState<SetupDraft>({ username: '', password: '' })
  const [updateDraft, setUpdateDraft] = useState<UpdateDraft>({
    currentPassword: '',
    nextUsername: '',
    nextPassword: '',
  })
  const [permissionGroupEditorMode, setPermissionGroupEditorMode] = useState<PermissionGroupEditorMode>(null)
  const [activePermissionGroupId, setActivePermissionGroupId] = useState<number | null>(null)
  const [permissionGroupDraft, setPermissionGroupDraft] = useState<PermissionGroupEditorDraft>(createEmptyPermissionGroupDraft())
  const [selectedAddMemberAccountId, setSelectedAddMemberAccountId] = useState<number | null>(null)

  const authStatus = authStatusQuery.data ?? null
  const hasCredentials = authStatus?.hasCredentials === true
  const isAdmin = authStatus?.isAdmin === true
  const currentUsername = authStatus?.username ?? null
  const canManageAccess = hasCredentials && isAdmin

  const accountsQuery = useQuery({
    queryKey: AUTH_ACCOUNTS_QUERY_KEY,
    queryFn: listAuthAccounts,
    enabled: canManageAccess,
    staleTime: 10_000,
  })

  const permissionGroupsQuery = useQuery({
    queryKey: AUTH_PERMISSION_GROUPS_QUERY_KEY,
    queryFn: listAuthPermissionGroups,
    enabled: canManageAccess,
    staleTime: 10_000,
  })

  const permissionGroupsLegacyQuery = useQuery({
    queryKey: ['auth-permission-groups', 'legacy-system'],
    queryFn: listPermissionGroups,
    enabled: canManageAccess,
    staleTime: 60_000,
  })

  const pageAccessQuery = useQuery({
    queryKey: AUTH_PAGE_ACCESS_QUERY_KEY,
    queryFn: getPageAccessMatrix,
    enabled: canManageAccess,
    staleTime: 10_000,
  })

  const activePermissionGroupDetailQuery = useQuery({
    queryKey: ['auth-permission-group-detail', activePermissionGroupId],
    queryFn: () => getAuthPermissionGroupDetail(activePermissionGroupId as number),
    enabled: canManageAccess && permissionGroupEditorMode === 'edit' && activePermissionGroupId !== null,
    staleTime: 0,
  })

  const activePermissionGroup = activePermissionGroupDetailQuery.data?.group ?? null
  const activePermissionGroupMembers = activePermissionGroupDetailQuery.data?.members ?? []

  useEffect(() => {
    if (permissionGroupEditorMode === 'create') {
      setPermissionGroupDraft(createEmptyPermissionGroupDraft())
      setSelectedAddMemberAccountId(null)
      return
    }

    if (permissionGroupEditorMode !== 'edit' || !activePermissionGroup) {
      return
    }

    setPermissionGroupDraft({
      name: activePermissionGroup.name,
      description: activePermissionGroup.description ?? '',
      permissionKeys: [...activePermissionGroup.directPermissionKeys],
    })
    setSelectedAddMemberAccountId(null)
  }, [activePermissionGroup, permissionGroupEditorMode])

  const setupMutation = useMutation({
    mutationFn: ({ username, password }: SetupDraft) => setupLocalAccount(username, password),
    onSuccess: (result, variables) => {
      const nextUsername = result.username ?? variables.username
      queryClient.setQueryData(
        AUTH_STATUS_QUERY_KEY,
        buildCachedAdminAuthStatus(result, authStatus, nextUsername),
      )
      setSetupDraft((draft) => ({ ...draft, password: '' }))
      setUpdateDraft({ currentPassword: '', nextUsername, nextPassword: '' })
      showSnackbar({ message: '관리자 계정을 만들었어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '계정 생성에 실패했어.', tone: 'error' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ currentPassword, nextUsername, nextPassword }: UpdateDraft) =>
      updateLocalAccount(currentPassword, nextUsername, nextPassword),
    onSuccess: (result, variables) => {
      const nextUsername = result.username ?? variables.nextUsername
      queryClient.setQueryData(
        AUTH_STATUS_QUERY_KEY,
        buildCachedAdminAuthStatus(result, authStatus, nextUsername),
      )
      setUpdateDraft({ currentPassword: '', nextUsername, nextPassword: '' })
      void queryClient.invalidateQueries({ queryKey: AUTH_ACCOUNTS_QUERY_KEY })
      showSnackbar({ message: '관리자 계정을 갱신했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '계정 갱신에 실패했어.', tone: 'error' })
    },
  })

  const accountGroupMutation = useMutation({
    mutationFn: ({ accountId, groupKey }: { accountId: number; groupKey: 'admin' | 'guest' }) =>
      updateAuthAccountSystemGroup(accountId, groupKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_ACCOUNTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['auth-permission-group-detail'] }),
      ])
      showSnackbar({ message: '기본 권한 그룹을 바꿨어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '권한 그룹 변경에 실패했어.', tone: 'error' })
    },
  })

  const savePermissionGroupMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: permissionGroupDraft.name.trim(),
        description: permissionGroupDraft.description.trim() || null,
        permissionKeys: permissionGroupDraft.permissionKeys,
      }

      if (permissionGroupEditorMode === 'create') {
        return createAuthPermissionGroup(payload)
      }

      if (!activePermissionGroup) {
        throw new Error('편집할 권한 그룹을 불러오지 못했어.')
      }

      if (activePermissionGroup.systemGroup) {
        if (activePermissionGroup.groupKey === 'anonymous' || activePermissionGroup.groupKey === 'guest') {
          return updateBuiltInPageAccess(activePermissionGroup.groupKey, payload.permissionKeys)
        }
        throw new Error('이 시스템 그룹은 여기서 수정할 수 없어.')
      }

      return updateAuthPermissionGroup(activePermissionGroup.id, payload)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_PERMISSION_GROUPS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_PAGE_ACCESS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['auth-permission-group-detail', activePermissionGroupId] }),
      ])
      setPermissionGroupEditorMode(null)
      setActivePermissionGroupId(null)
      setPermissionGroupDraft(createEmptyPermissionGroupDraft())
      setSelectedAddMemberAccountId(null)
      showSnackbar({ message: permissionGroupEditorMode === 'create' ? '권한 그룹을 만들었어.' : '권한 그룹을 저장했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '권한 그룹 저장에 실패했어.', tone: 'error' })
    },
  })

  const deletePermissionGroupMutation = useMutation({
    mutationFn: (groupId: number) => deleteAuthPermissionGroup(groupId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_PERMISSION_GROUPS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
      ])
      setPermissionGroupEditorMode(null)
      setActivePermissionGroupId(null)
      setPermissionGroupDraft(createEmptyPermissionGroupDraft())
      setSelectedAddMemberAccountId(null)
      showSnackbar({ message: '권한 그룹을 삭제했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '권한 그룹 삭제에 실패했어.', tone: 'error' })
    },
  })

  const addPermissionGroupMemberMutation = useMutation({
    mutationFn: ({ groupId, accountId }: { groupId: number; accountId: number }) => addAuthPermissionGroupMember(groupId, accountId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_PERMISSION_GROUPS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_ACCOUNTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['auth-permission-group-detail', activePermissionGroupId] }),
      ])
      setSelectedAddMemberAccountId(null)
      showSnackbar({ message: '그룹에 계정을 추가했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 멤버 추가에 실패했어.', tone: 'error' })
    },
  })

  const removePermissionGroupMemberMutation = useMutation({
    mutationFn: ({ groupId, accountId }: { groupId: number; accountId: number }) => removeAuthPermissionGroupMember(groupId, accountId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_PERMISSION_GROUPS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_ACCOUNTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['auth-permission-group-detail', activePermissionGroupId] }),
      ])
      showSnackbar({ message: '그룹에서 계정을 뺐어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 멤버 제거에 실패했어.', tone: 'error' })
    },
  })

  const editablePermissionCatalog = useMemo(() => {
    const catalog = pageAccessQuery.data?.permissions ?? []
    if (activePermissionGroup?.groupKey === 'anonymous') {
      return catalog.filter((permission) => permission.permissionKey === 'page.wallpaper.runtime.view')
    }
    return catalog
  }, [activePermissionGroup?.groupKey, pageAccessQuery.data?.permissions])

  const addableAccounts = useMemo(() => {
    const memberIds = new Set(activePermissionGroupMembers.map((member) => member.id))
    return (accountsQuery.data ?? []).filter((account) => !memberIds.has(account.id))
  }, [accountsQuery.data, activePermissionGroupMembers])

  const openCreatePermissionGroupEditor = () => {
    setPermissionGroupEditorMode('create')
    setActivePermissionGroupId(null)
    setPermissionGroupDraft(createEmptyPermissionGroupDraft())
    setSelectedAddMemberAccountId(null)
  }

  const openEditPermissionGroupEditor = (group: AuthPermissionGroupSummaryItem) => {
    setPermissionGroupEditorMode('edit')
    setActivePermissionGroupId(group.id)
    setPermissionGroupDraft({
      name: group.name,
      description: group.description ?? '',
      permissionKeys: [...group.directPermissionKeys],
    })
    setSelectedAddMemberAccountId(null)
  }

  const closePermissionGroupEditor = () => {
    setPermissionGroupEditorMode(null)
    setActivePermissionGroupId(null)
    setPermissionGroupDraft(createEmptyPermissionGroupDraft())
    setSelectedAddMemberAccountId(null)
  }

  const patchPermissionGroupDraft = (patch: Partial<PermissionGroupEditorDraft>) => {
    setPermissionGroupDraft((current) => ({ ...current, ...patch }))
  }

  const togglePermissionKey = (permissionKey: string, enabled: boolean) => {
    setPermissionGroupDraft((current) => ({
      ...current,
      permissionKeys: enabled
        ? Array.from(new Set([...current.permissionKeys, permissionKey]))
        : current.permissionKeys.filter((currentPermissionKey) => currentPermissionKey !== permissionKey),
    }))
  }

  const submitSetup = () => {
    const username = setupDraft.username.trim()
    if (!username || !setupDraft.password) {
      return
    }

    void setupMutation.mutateAsync({ username, password: setupDraft.password })
  }

  const submitUpdate = () => {
    const nextUsername = updateDraft.nextUsername.trim() || currentUsername || ''
    if (!updateDraft.currentPassword || !nextUsername || !updateDraft.nextPassword) {
      return
    }

    void updateMutation.mutateAsync({
      currentPassword: updateDraft.currentPassword,
      nextUsername,
      nextPassword: updateDraft.nextPassword,
    })
  }

  const updateAccountGroup = (accountId: number, groupKey: 'admin' | 'guest') => {
    void accountGroupMutation.mutateAsync({ accountId, groupKey })
  }

  const submitPermissionGroupEditor = () => {
    if (!permissionGroupDraft.name.trim() && permissionGroupEditorMode === 'create') {
      showSnackbar({ message: '그룹 이름은 필요해.', tone: 'error' })
      return
    }

    if (activePermissionGroup?.systemGroup && activePermissionGroup.groupKey === 'admin') {
      showSnackbar({ message: 'admin 시스템 그룹은 여기서 수정하지 않는 게 맞아.', tone: 'error' })
      return
    }

    void savePermissionGroupMutation.mutateAsync()
  }

  const deletePermissionGroup = (groupId: number) => {
    void deletePermissionGroupMutation.mutateAsync(groupId)
  }

  const addPermissionGroupMember = () => {
    if (!activePermissionGroup || selectedAddMemberAccountId === null) {
      return
    }

    void addPermissionGroupMemberMutation.mutateAsync({
      groupId: activePermissionGroup.id,
      accountId: selectedAddMemberAccountId,
    })
  }

  const removePermissionGroupMember = (accountId: number) => {
    if (!activePermissionGroup) {
      return
    }

    void removePermissionGroupMemberMutation.mutateAsync({
      groupId: activePermissionGroup.id,
      accountId,
    })
  }

  const isPermissionGroupEditorOpen = permissionGroupEditorMode !== null
  const activePermissionGroupSummary = activePermissionGroup ?? permissionGroupsQuery.data?.find((group) => group.id === activePermissionGroupId) ?? null
  const canEditPermissionGroupFields = !activePermissionGroupSummary?.systemGroup
  const canEditPermissionGroupPermissions = permissionGroupEditorMode === 'create'
    || !activePermissionGroupSummary
    || !activePermissionGroupSummary.systemGroup
    || activePermissionGroupSummary.groupKey === 'anonymous'
    || activePermissionGroupSummary.groupKey === 'guest'
  const canManagePermissionGroupMembers = permissionGroupEditorMode === 'edit' && Boolean(activePermissionGroupSummary) && !activePermissionGroupSummary?.systemGroup
  const canDeletePermissionGroup = Boolean(activePermissionGroupSummary && !activePermissionGroupSummary.systemGroup)

  return {
    isLoading: authStatusQuery.isLoading,
    authStatus,
    hasCredentials,
    isAdmin,
    currentUsername,
    canManageCredentials: !hasCredentials || isAdmin,
    canManageAccess,
    databaseInfo: databaseInfoQuery.data ?? null,
    setupDraft,
    updateDraft,
    setSetupDraft,
    setUpdateDraft,
    submitSetup,
    submitUpdate,
    isSubmittingSetup: setupMutation.isPending,
    isSubmittingUpdate: updateMutation.isPending,
    accounts: accountsQuery.data ?? [],
    isLoadingAccounts: accountsQuery.isLoading,
    availableGroups: permissionGroupsLegacyQuery.data ?? [],
    updateAccountGroup,
    isUpdatingAccountGroup: accountGroupMutation.isPending,
    permissionGroups: permissionGroupsQuery.data ?? [],
    isLoadingPermissionGroups: permissionGroupsQuery.isLoading,
    pagePermissionCatalog: editablePermissionCatalog,
    isLoadingPagePermissions: pageAccessQuery.isLoading,
    openCreatePermissionGroupEditor,
    openEditPermissionGroupEditor,
    closePermissionGroupEditor,
    isPermissionGroupEditorOpen,
    permissionGroupEditorMode,
    permissionGroupDraft,
    patchPermissionGroupDraft,
    togglePermissionKey,
    submitPermissionGroupEditor,
    deletePermissionGroup,
    isSavingPermissionGroup: savePermissionGroupMutation.isPending,
    isDeletingPermissionGroup: deletePermissionGroupMutation.isPending,
    activePermissionGroup: activePermissionGroupSummary,
    activePermissionGroupMembers,
    isLoadingPermissionGroupDetail: activePermissionGroupDetailQuery.isLoading,
    canEditPermissionGroupFields,
    canEditPermissionGroupPermissions,
    canManagePermissionGroupMembers,
    canDeletePermissionGroup,
    selectedAddMemberAccountId,
    setSelectedAddMemberAccountId,
    addableAccounts,
    addPermissionGroupMember,
    removePermissionGroupMember,
    isAddingPermissionGroupMember: addPermissionGroupMemberMutation.isPending,
    isRemovingPermissionGroupMember: removePermissionGroupMemberMutation.isPending,
  }
}
