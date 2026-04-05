import { useCallback, useEffect, useState } from 'react'
import {
  createGenerationComfyUIServer,
  deleteGenerationComfyUIServer,
  testGenerationComfyUIServer,
  updateGenerationComfyUIServer,
} from '@/lib/api'
import type { ComfyUIServer } from '@/lib/api-image-generation'
import {
  DEFAULT_COMFYUI_SERVER_FORM,
  getErrorMessage,
  type ComfyUIServerFormDraft,
  type ComfyUIServerTestState,
} from '../image-generation-shared'

/** Manage ComfyUI server selection, registration, editing, deletion, and connectivity tests for the panel. */
export function useComfyServerController({
  activeServers,
  selectedWorkflowId,
  refetchServers,
  showSnackbar,
}: {
  activeServers: ComfyUIServer[]
  selectedWorkflowId: number | null
  refetchServers: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isComfyServerSubmitting, setIsComfyServerSubmitting] = useState(false)
  const [comfyServerForm, setComfyServerForm] = useState<ComfyUIServerFormDraft>(DEFAULT_COMFYUI_SERVER_FORM)
  const [editingServerId, setEditingServerId] = useState<number | null>(null)
  const [comfyServerTests, setComfyServerTests] = useState<Record<number, ComfyUIServerTestState>>({})
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [isServerModalOpen, setIsServerModalOpen] = useState(false)

  /** Update one editable ComfyUI server form field. */
  const handleComfyServerFieldChange = (field: keyof ComfyUIServerFormDraft, value: string) => {
    setComfyServerForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  /** Reset server editor state back to the default create flow. */
  const resetComfyServerEditor = () => {
    setEditingServerId(null)
    setComfyServerForm(DEFAULT_COMFYUI_SERVER_FORM)
  }

  /** Open the ComfyUI server create modal with a clean form. */
  const handleOpenCreateServer = () => {
    resetComfyServerEditor()
    setIsServerModalOpen(true)
  }

  /** Close the ComfyUI server modal and reset editor state. */
  const handleCloseServerModal = () => {
    setIsServerModalOpen(false)
    resetComfyServerEditor()
  }

  /** Test a single ComfyUI server and cache its reachability state. */
  const handleTestComfyServer = useCallback(async (serverId: number, options?: { silent?: boolean }) => {
    setComfyServerTests((current) => ({
      ...current,
      [serverId]: {
        ...current[serverId],
        isLoading: true,
        error: undefined,
      },
    }))

    try {
      const status = await testGenerationComfyUIServer(serverId)
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          status,
        },
      }))

      if (!options?.silent) {
        showSnackbar({ message: status.is_connected ? 'ComfyUI 서버 연결 확인 완료.' : 'ComfyUI 서버 연결 실패.', tone: status.is_connected ? 'info' : 'error' })
      }
    } catch (error) {
      const message = getErrorMessage(error, 'ComfyUI 서버 연결 테스트에 실패했어.')
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          error: message,
        },
      }))

      if (!options?.silent) {
        showSnackbar({ message, tone: 'error' })
      }
    }
  }, [showSnackbar])

  useEffect(() => {
    if (activeServers.length === 0) {
      if (selectedServerId.length > 0) {
        setSelectedServerId('')
      }
      return
    }

    const stillExists = activeServers.some((server) => String(server.id) === selectedServerId)
    if (!stillExists) {
      setSelectedServerId(String(activeServers[0].id))
    }
  }, [activeServers, selectedServerId])

  useEffect(() => {
    if (selectedWorkflowId === null || activeServers.length === 0) {
      return
    }

    const untestedServers = activeServers.filter((server) => !comfyServerTests[server.id])
    if (untestedServers.length === 0) {
      return
    }

    for (const server of untestedServers) {
      void handleTestComfyServer(server.id, { silent: true })
    }
  }, [activeServers, comfyServerTests, handleTestComfyServer, selectedWorkflowId])

  /** Submit the current server create/edit form and refresh server state. */
  const handleSubmitComfyServer = async () => {
    if (isComfyServerSubmitting) {
      return
    }

    const name = comfyServerForm.name.trim()
    const endpoint = comfyServerForm.endpoint.trim()

    if (name.length === 0 || endpoint.length === 0) {
      showSnackbar({ message: '서버 이름과 endpoint는 꼭 필요해.', tone: 'error' })
      return
    }

    try {
      setIsComfyServerSubmitting(true)

      if (editingServerId !== null) {
        await updateGenerationComfyUIServer(editingServerId, {
          name,
          endpoint,
          description: comfyServerForm.description.trim() || undefined,
          is_active: true,
        })

        await refetchServers()
        setSelectedServerId(String(editingServerId))
        handleCloseServerModal()
        showSnackbar({ message: 'ComfyUI 서버를 수정했어.', tone: 'info' })
        await handleTestComfyServer(editingServerId)
      } else {
        const response = await createGenerationComfyUIServer({
          name,
          endpoint,
          description: comfyServerForm.description.trim() || undefined,
        })

        await refetchServers()
        setSelectedServerId(String(response.data.id))
        handleCloseServerModal()
        showSnackbar({ message: 'ComfyUI 서버를 등록했어.', tone: 'info' })
        await handleTestComfyServer(response.data.id)
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, editingServerId !== null ? 'ComfyUI 서버 수정에 실패했어.' : 'ComfyUI 서버 등록에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyServerSubmitting(false)
    }
  }

  /** Open the edit modal for one existing ComfyUI server. */
  const handleEditServer = (serverId: number) => {
    const server = activeServers.find((item) => item.id === serverId)
    if (!server) {
      return
    }

    setEditingServerId(server.id)
    setComfyServerForm({
      name: server.name,
      endpoint: server.endpoint,
      description: server.description ?? '',
    })
    setIsServerModalOpen(true)
  }

  /** Delete one ComfyUI server after confirmation and refresh cached test state. */
  const handleDeleteServer = async (serverId: number) => {
    const server = activeServers.find((item) => item.id === serverId)
    if (!server) {
      return
    }

    const confirmed = window.confirm(`정말 ${server.name} 서버를 삭제할까?`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationComfyUIServer(serverId)
      await refetchServers()
      setComfyServerTests((current) => {
        const next = { ...current }
        delete next[serverId]
        return next
      })
      if (selectedServerId === String(serverId)) {
        setSelectedServerId('')
      }
      showSnackbar({ message: 'ComfyUI 서버를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 서버 삭제에 실패했어.'), tone: 'error' })
    }
  }

  return {
    isComfyServerSubmitting,
    comfyServerForm,
    editingServerId,
    comfyServerTests,
    selectedServerId,
    setSelectedServerId,
    isServerModalOpen,
    handleComfyServerFieldChange,
    resetComfyServerEditor,
    handleOpenCreateServer,
    handleCloseServerModal,
    handleTestComfyServer,
    handleSubmitComfyServer,
    handleEditServer,
    handleDeleteServer,
  }
}
