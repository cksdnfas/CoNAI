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

function parseRoutingTagsCsv(value: string) {
  return Array.from(new Set(value.split(',').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)))
}

/** Manage ComfyUI server selection, registration, editing, deletion, and connectivity tests for the panel. */
export function useComfyServerController({
  activeServers,
  refetchServers,
  showSnackbar,
}: {
  activeServers: ComfyUIServer[]
  refetchServers: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isComfyServerSubmitting, setIsComfyServerSubmitting] = useState(false)
  const [comfyServerForm, setComfyServerForm] = useState<ComfyUIServerFormDraft>(DEFAULT_COMFYUI_SERVER_FORM)
  const [editingServerId, setEditingServerId] = useState<number | null>(null)
  const [comfyServerTests, setComfyServerTests] = useState<Record<number, ComfyUIServerTestState>>({})
  const [selectedTarget, setSelectedTarget] = useState<string>('auto')
  const [isServerModalOpen, setIsServerModalOpen] = useState(false)

  /** Update one editable ComfyUI server form field. */
  const handleComfyServerFieldChange = (field: keyof ComfyUIServerFormDraft, value: string) => {
    setComfyServerForm((current) => {
      if (field === 'backendType') {
        const backendType = value === 'modal' ? 'modal' : 'comfyui'
        return {
          ...current,
          backendType,
          capacity: current.capacity === '1' || current.capacity === '10' || current.capacity.trim().length === 0
            ? (backendType === 'modal' ? '10' : '1')
            : current.capacity,
        }
      }

      return {
        ...current,
        [field]: value,
      }
    })
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
    const server = activeServers.find((item) => item.id === serverId)
    if (server?.backend_type === 'modal') {
      if (options?.silent) {
        return
      }

      const confirmed = window.confirm('Modal 서버 테스트는 원격 endpoint를 호출해서 GPU 컨테이너가 켜지고 비용이 발생할 수 있어. 계속할까?')
      if (!confirmed) {
        return
      }
    }

    setComfyServerTests((current) => ({
      ...current,
      [serverId]: {
        ...current[serverId],
        isLoading: true,
        error: undefined,
      },
    }))

    try {
      const status = await testGenerationComfyUIServer(serverId, { probe: server?.backend_type === 'modal' })
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          status,
        },
      }))

      if (!options?.silent) {
        const successMessage = server?.backend_type === 'modal' ? 'Modal 서버 수동 테스트 완료.' : 'ComfyUI 서버 연결 확인 완료.'
        const failureMessage = server?.backend_type === 'modal' ? 'Modal 서버 수동 테스트 실패.' : 'ComfyUI 서버 연결 실패.'
        showSnackbar({ message: status.is_connected ? successMessage : failureMessage, tone: status.is_connected ? 'info' : 'error' })
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
  }, [activeServers, showSnackbar])

  useEffect(() => {
    if (selectedTarget === 'auto' || selectedTarget.startsWith('tag:')) {
      return
    }

    if (!selectedTarget.startsWith('server:')) {
      setSelectedTarget('auto')
      return
    }

    const selectedServerId = Number(selectedTarget.slice('server:'.length))
    const stillExists = activeServers.some((server) => server.id === selectedServerId)
    if (!stillExists) {
      setSelectedTarget('auto')
    }
  }, [activeServers, selectedTarget])

  useEffect(() => {
    if (activeServers.length === 0) {
      return
    }

    const untestedServers = activeServers.filter((server) => server.backend_type !== 'modal' && !comfyServerTests[server.id])
    if (untestedServers.length === 0) {
      return
    }

    for (const server of untestedServers) {
      void handleTestComfyServer(server.id, { silent: true })
    }
  }, [activeServers, comfyServerTests, handleTestComfyServer])

  /** Submit the current server create/edit form and refresh server state. */
  const handleSubmitComfyServer = async () => {
    if (isComfyServerSubmitting) {
      return
    }

    const name = comfyServerForm.name.trim()
    const endpoint = comfyServerForm.endpoint.trim()
    const capacity = Math.max(1, Math.min(100, Number.parseInt(comfyServerForm.capacity, 10) || (comfyServerForm.backendType === 'modal' ? 10 : 1)))

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
          backend_type: comfyServerForm.backendType,
          capacity,
          description: comfyServerForm.description.trim() || undefined,
          routing_tags: parseRoutingTagsCsv(comfyServerForm.routingTags),
          is_active: true,
        })

        await refetchServers()
        setSelectedTarget(`server:${editingServerId}`)
        handleCloseServerModal()
        showSnackbar({ message: comfyServerForm.backendType === 'modal' ? 'Modal 서버를 수정했어. 자동 상태확인은 건너뛸게.' : 'ComfyUI 서버를 수정했어.', tone: 'info' })
        if (comfyServerForm.backendType !== 'modal') {
          await handleTestComfyServer(editingServerId)
        }
      } else {
        const response = await createGenerationComfyUIServer({
          name,
          endpoint,
          backend_type: comfyServerForm.backendType,
          capacity,
          description: comfyServerForm.description.trim() || undefined,
          routing_tags: parseRoutingTagsCsv(comfyServerForm.routingTags),
        })

        await refetchServers()
        setSelectedTarget(`server:${response.data.id}`)
        handleCloseServerModal()
        showSnackbar({ message: comfyServerForm.backendType === 'modal' ? 'Modal 서버를 등록했어. 자동 상태확인은 건너뛸게.' : 'ComfyUI 서버를 등록했어.', tone: 'info' })
        if (comfyServerForm.backendType !== 'modal') {
          await handleTestComfyServer(response.data.id)
        }
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
      backendType: server.backend_type ?? 'comfyui',
      capacity: String(server.capacity ?? (server.backend_type === 'modal' ? 10 : 1)),
      description: server.description ?? '',
      routingTags: (server.routing_tags ?? []).join(', '),
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
      if (selectedTarget === `server:${serverId}`) {
        setSelectedTarget('auto')
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
    selectedTarget,
    setSelectedTarget,
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
