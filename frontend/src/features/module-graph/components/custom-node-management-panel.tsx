import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  listCustomNodes,
  rescanCustomNodes,
  scaffoldCustomNode,
  testCustomNode,
  type CustomNodeScaffoldTemplate,
} from '@/lib/api'

type CustomNodeManagementPanelProps = {
  onModulesChanged?: () => Promise<unknown> | void
}

function stringifyPrettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Render a local-only manager for file-based custom nodes inside the module graph workspace. */
export function CustomNodeManagementPanel({ onModulesChanged }: CustomNodeManagementPanelProps) {
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [folderName, setFolderName] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [nodeDescription, setNodeDescription] = useState('')
  const [scaffoldTemplate, setScaffoldTemplate] = useState<CustomNodeScaffoldTemplate>('empty')
  const [selectedTestKey, setSelectedTestKey] = useState<string>('')
  const [testInputsText, setTestInputsText] = useState('{}')
  const [testResultText, setTestResultText] = useState('')

  const customNodesQuery = useQuery({
    queryKey: ['custom-nodes'],
    queryFn: listCustomNodes,
  })

  const loadedNodes = customNodesQuery.data?.nodes ?? []
  const loadErrors = customNodesQuery.data?.errors ?? []

  const selectedTestNode = useMemo(
    () => loadedNodes.find((node) => node.manifest.key === selectedTestKey) ?? null,
    [loadedNodes, selectedTestKey],
  )

  const handleModulesChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: ['custom-nodes'] })
    await onModulesChanged?.()
  }

  const rescanMutation = useMutation({
    mutationFn: rescanCustomNodes,
    onSuccess: async (result) => {
      showSnackbar({
        message: `커스텀 노드 ${result.nodes.length}개 스캔 완료. 오류 ${result.errors.length}개.`,
        tone: result.errors.length > 0 ? 'error' : 'info',
      })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : '커스텀 노드 재스캔에 실패했어.',
        tone: 'error',
      })
    },
  })

  const scaffoldMutation = useMutation({
    mutationFn: scaffoldCustomNode,
    onSuccess: async (result) => {
      setFolderName('')
      setNodeKey('')
      setNodeName('')
      setNodeDescription('')
      setSelectedTestKey(result.sync.nodes[0]?.manifest.key ?? '')
      showSnackbar({ message: `커스텀 노드 폴더를 만들었어: ${result.folderPath}`, tone: 'info' })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : '커스텀 노드 스캐폴드 생성에 실패했어.',
        tone: 'error',
      })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTestKey) {
        throw new Error('먼저 테스트할 커스텀 노드를 하나 골라줘.')
      }

      let parsedInputs: Record<string, unknown> = {}
      const trimmed = testInputsText.trim()
      if (trimmed.length > 0) {
        const parsed = JSON.parse(trimmed)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('테스트 입력은 JSON object 형태여야 해.')
        }
        parsedInputs = parsed as Record<string, unknown>
      }

      return await testCustomNode(selectedTestKey, parsedInputs)
    },
    onSuccess: (result) => {
      setTestResultText(stringifyPrettyJson(result))
      showSnackbar({ message: `커스텀 노드 테스트 완료: ${result.name}`, tone: 'info' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '커스텀 노드 테스트 실행에 실패했어.'
      setTestResultText(message)
      showSnackbar({ message, tone: 'error' })
    },
  })

  return (
    <div className="space-y-6">
      <SectionHeading
        heading="커스텀 노드 관리"
        description={customNodesQuery.data?.customNodesDir ?? 'user/custom_nodes'}
        actions={(
          <>
            <Badge variant="outline">로컬 파일 기반</Badge>
            <Button type="button" variant="outline" onClick={() => void rescanMutation.mutateAsync()} disabled={rescanMutation.isPending}>
              {rescanMutation.isPending ? '재스캔 중...' : '재스캔'}
            </Button>
          </>
        )}
      />

      {customNodesQuery.isLoading ? (
        <Alert>
          <AlertTitle>불러오는 중</AlertTitle>
          <AlertDescription>커스텀 노드 폴더를 읽고 있어.</AlertDescription>
        </Alert>
      ) : null}

      {customNodesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>목록 로드 실패</AlertTitle>
          <AlertDescription>{customNodesQuery.error instanceof Error ? customNodesQuery.error.message : '커스텀 노드 목록을 불러오지 못했어.'}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <SectionHeading
                heading="등록된 커스텀 노드"
                description="user/custom_nodes 아래 폴더를 스캔한 결과야."
                variant="inside"
                actions={<Badge variant="outline">{loadedNodes.length}</Badge>}
              />

              {loadedNodes.length === 0 ? (
                <Alert>
                  <AlertTitle>노드 없음</AlertTitle>
                  <AlertDescription>아직 로드된 커스텀 노드가 없어. 스캐폴드로 하나 만들거나 폴더를 추가한 뒤 재스캔해.</AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {loadedNodes.map((node) => {
                    const isSelected = selectedTestKey === node.manifest.key
                    return (
                      <div key={node.manifest.key} className="rounded-sm border border-border/70 bg-background/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{node.manifest.name}</span>
                              <Badge variant="outline">{node.manifest.key}</Badge>
                              <Badge variant="outline">{node.manifest.entry}</Badge>
                            </div>
                            {node.manifest.description ? <div className="text-sm text-muted-foreground">{node.manifest.description}</div> : null}
                            <div className="text-xs text-muted-foreground">{node.folderPath}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? 'default' : 'outline'}
                              onClick={() => {
                                setSelectedTestKey(node.manifest.key)
                                setTestResultText('')
                              }}
                            >
                              {isSelected ? '테스트 대상' : '테스트 선택'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <SectionHeading
                heading="로드 오류"
                description="manifest 또는 entry 파일에 문제가 있으면 여기에 보여줘."
                variant="inside"
                actions={<Badge variant="outline">{loadErrors.length}</Badge>}
              />

              {loadErrors.length === 0 ? (
                <Alert>
                  <AlertTitle>오류 없음</AlertTitle>
                  <AlertDescription>현재 감지된 로드 오류는 없어.</AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {loadErrors.map((errorItem) => (
                    <Alert key={`${errorItem.folderPath}:${errorItem.message}`} variant="destructive">
                      <AlertTitle>{errorItem.folderName}</AlertTitle>
                      <AlertDescription>
                        <div className="text-sm">{errorItem.message}</div>
                        <div className="mt-1 text-xs opacity-90">{errorItem.folderPath}</div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <SectionHeading heading="새 노드 스캐폴드" description="기본 폴더와 starter 파일을 바로 만들어." variant="inside" />

              <div className="space-y-3">
                <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="folder name (예: weather-api)" />
                <Input value={nodeKey} onChange={(event) => setNodeKey(event.target.value)} placeholder="node key (예: custom.weather_api)" />
                <Input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="표시 이름" />
                <Textarea rows={3} value={nodeDescription} onChange={(event) => setNodeDescription(event.target.value)} placeholder="설명 (선택)" />
                <Select value={scaffoldTemplate} onChange={(event) => setScaffoldTemplate(event.target.value as CustomNodeScaffoldTemplate)}>
                  <option value="empty">Empty</option>
                  <option value="http_json">HTTP JSON</option>
                </Select>
                <Button
                  type="button"
                  onClick={() => void scaffoldMutation.mutateAsync({
                    folderName: folderName.trim(),
                    key: nodeKey.trim(),
                    name: nodeName.trim(),
                    description: nodeDescription.trim() || undefined,
                    template: scaffoldTemplate,
                  })}
                  disabled={scaffoldMutation.isPending || !folderName.trim() || !nodeKey.trim() || !nodeName.trim()}
                >
                  {scaffoldMutation.isPending ? '생성 중...' : '스캐폴드 생성'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <SectionHeading
                heading="단건 테스트"
                description={selectedTestNode ? `${selectedTestNode.manifest.name} 테스트` : '먼저 테스트할 노드를 선택해.'}
                variant="inside"
              />

              <Textarea
                rows={8}
                value={testInputsText}
                onChange={(event) => setTestInputsText(event.target.value)}
                placeholder={"{\n  \"input\": \"value\"\n}"}
              />
              <Button type="button" variant="outline" onClick={() => void testMutation.mutateAsync()} disabled={testMutation.isPending || !selectedTestKey}>
                {testMutation.isPending ? '테스트 실행 중...' : '테스트 실행'}
              </Button>
              <Textarea rows={14} value={testResultText} placeholder="테스트 결과가 여기에 보여." readOnly />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
