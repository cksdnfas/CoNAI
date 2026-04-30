import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { SettingsField, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import {
  getCustomNodeSource,
  installCustomNodeDependencies,
  listCustomNodes,
  openCustomNodeFolder,
  rescanCustomNodes,
  scaffoldCustomNode,
  testCustomNode,
  type CustomNodeScaffoldTemplate,
  type CustomNodeTestResult,
} from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'

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

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//.test(value)
}

function isLikelyFilePath(value: unknown): value is string {
  return typeof value === 'string' && !/^data:image\//.test(value) && /[\\/]|\.[a-z0-9]+$/i.test(value)
}

type PanelCardHeaderProps = {
  title: string
  description: string
  actions?: ReactNode
}

function PanelCardHeader({ title, description, actions }: PanelCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

/** Render a local-only manager for file-based custom nodes inside the module graph workspace. */
export function CustomNodeManagementPanel({ onModulesChanged }: CustomNodeManagementPanelProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [folderName, setFolderName] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [nodeDescription, setNodeDescription] = useState('')
  const [scaffoldTemplate, setScaffoldTemplate] = useState<CustomNodeScaffoldTemplate>('empty')
  const [selectedTestKey, setSelectedTestKey] = useState<string>('')
  const [testInputsText, setTestInputsText] = useState('{}')
  const [testResultText, setTestResultText] = useState('')
  const [testResultData, setTestResultData] = useState<CustomNodeTestResult | null>(null)
  const [installResultText, setInstallResultText] = useState('')

  const customNodesQuery = useQuery({
    queryKey: ['custom-nodes'],
    queryFn: listCustomNodes,
  })

  const loadedNodes = useMemo(() => customNodesQuery.data?.nodes ?? [], [customNodesQuery.data?.nodes])
  const loadErrors = customNodesQuery.data?.errors ?? []

  const selectedTestNode = useMemo(
    () => loadedNodes.find((node) => node.manifest.key === selectedTestKey) ?? null,
    [loadedNodes, selectedTestKey],
  )

  const testResultNode = useMemo(
    () => loadedNodes.find((node) => node.manifest.key === testResultData?.key) ?? null,
    [loadedNodes, testResultData?.key],
  )

  const selectedNodeSourceQuery = useQuery({
    queryKey: ['custom-node-source', selectedTestKey],
    queryFn: () => getCustomNodeSource(selectedTestKey),
    enabled: !!selectedTestKey,
  })

  const previewableImageOutputs = useMemo(() => {
    if (!testResultData || !testResultNode) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    return testResultNode.manifest.outputs
      .filter((port) => (port.data_type === 'image' || port.data_type === 'mask') && isImageDataUrl(testResultData.outputs[port.key]))
      .map((port) => ({
        key: port.key,
        label: port.label ?? port.key,
        value: testResultData.outputs[port.key] as string,
      }))
  }, [testResultData, testResultNode])

  const filePathOutputs = useMemo(() => {
    if (!testResultData || !testResultNode) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    return testResultNode.manifest.outputs
      .filter((port) => (port.data_type === 'image' || port.data_type === 'mask') && isLikelyFilePath(testResultData.outputs[port.key]))
      .map((port) => ({
        key: port.key,
        label: port.label ?? port.key,
        value: testResultData.outputs[port.key] as string,
      }))
  }, [testResultData, testResultNode])

  const handleModulesChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: ['custom-nodes'] })
    await onModulesChanged?.()
  }

  const rescanMutation = useMutation({
    mutationFn: rescanCustomNodes,
    onSuccess: async (result) => {
      showSnackbar({
        message: t({ ko: '커스텀 노드 {nodes}개 스캔 완료. 오류 {errors}개.', en: 'Scanned {nodes} custom nodes. {errors} errors.' }, { nodes: result.nodes.length, errors: result.errors.length }),
        tone: result.errors.length > 0 ? 'error' : 'info',
      })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 재스캔에 실패했어.', en: 'Failed to rescan custom nodes.' }),
        tone: 'error',
      })
    },
  })

  const scaffoldMutation = useMutation({
    mutationFn: scaffoldCustomNode,
    onSuccess: async (result, variables) => {
      setFolderName('')
      setNodeKey('')
      setNodeName('')
      setNodeDescription('')
      setSelectedTestKey(variables.key)
      setTestResultData(null)
      setTestResultText('')
      setInstallResultText('')
      showSnackbar({ message: t({ ko: '커스텀 노드 폴더를 만들었어: {path}', en: 'Created the custom node folder: {path}' }, { path: result.folderPath }), tone: 'info' })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 스캐폴드 생성에 실패했어.', en: 'Failed to create the custom node scaffold.' }),
        tone: 'error',
      })
    },
  })

  const openFolderMutation = useMutation({
    mutationFn: async (key: string) => await openCustomNodeFolder(key),
    onSuccess: (result) => {
      showSnackbar({ message: t({ ko: '커스텀 노드 폴더를 열었어: {path}', en: 'Opened the custom node folder: {path}' }, { path: result.folderPath }), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 폴더 열기에 실패했어.', en: 'Failed to open the custom node folder.' }),
        tone: 'error',
      })
    },
  })

  const installDependenciesMutation = useMutation({
    mutationFn: async (key: string) => await installCustomNodeDependencies(key),
    onSuccess: (result) => {
      setInstallResultText(stringifyPrettyJson(result))
      showSnackbar({ message: t({ ko: 'npm install 완료: {key}', en: 'npm install complete: {key}' }, { key: result.key }), tone: 'info' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t({ ko: '커스텀 노드 의존성 설치에 실패했어.', en: 'Failed to install custom node dependencies.' })
      setInstallResultText(message)
      showSnackbar({ message, tone: 'error' })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTestKey) {
        throw new Error(t({ ko: '먼저 테스트할 커스텀 노드를 하나 골라줘.', en: 'Select a custom node to test first.' }))
      }

      let parsedInputs: Record<string, unknown> = {}
      const trimmed = testInputsText.trim()
      if (trimmed.length > 0) {
        const parsed = JSON.parse(trimmed)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t({ ko: '테스트 입력은 JSON object 형태여야 해.', en: 'Test input must be a JSON object.' }))
        }
        parsedInputs = parsed as Record<string, unknown>
      }

      return await testCustomNode(selectedTestKey, parsedInputs)
    },
    onSuccess: (result) => {
      setTestResultData(result)
      setTestResultText(stringifyPrettyJson(result))
      showSnackbar({ message: t({ ko: '커스텀 노드 테스트 완료: {name}', en: 'Custom node test complete: {name}' }, { name: result.name }), tone: 'info' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t({ ko: '커스텀 노드 테스트 실행에 실패했어.', en: 'Failed to run the custom node test.' })
      setTestResultData(null)
      setTestResultText(message)
      showSnackbar({ message, tone: 'error' })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-sm border border-border/70 bg-surface-low px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t({ ko: '커스텀 노드 디렉터리', en: 'Custom Nodes Directory' })}</div>
          <div className="mt-1 break-all text-sm text-foreground">{customNodesQuery.data?.customNodesDir ?? 'user/custom_nodes'}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{t({ ko: '로컬 파일 기반', en: 'Local file-based' })}</Badge>
          <Button type="button" variant="outline" onClick={() => void rescanMutation.mutateAsync()} disabled={rescanMutation.isPending}>
            {rescanMutation.isPending ? t({ ko: '재스캔 중...', en: 'Rescanning...' }) : t({ ko: '재스캔', en: 'Rescan' })}
          </Button>
        </div>
      </div>

      {customNodesQuery.isLoading ? (
        <Alert>
          <AlertTitle>{t({ ko: '불러오는 중', en: 'Loading' })}</AlertTitle>
          <AlertDescription>{t({ ko: '커스텀 노드 폴더를 읽고 있어.', en: 'Reading the custom node folders.' })}</AlertDescription>
        </Alert>
      ) : null}

      {customNodesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '목록 로드 실패', en: 'Failed to load list' })}</AlertTitle>
          <AlertDescription>{customNodesQuery.error instanceof Error ? customNodesQuery.error.message : t({ ko: '커스텀 노드 목록을 불러오지 못했어.', en: 'Failed to load the custom node list.' })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3">
              <PanelCardHeader
                title={t({ ko: '등록된 커스텀 노드', en: 'Registered custom nodes' })}
                description={t({ ko: 'user/custom_nodes 아래 폴더를 스캔한 결과야.', en: 'These are the results of scanning folders under user/custom_nodes.' })}
                actions={<Badge variant="outline">{loadedNodes.length}</Badge>}
              />

              {loadedNodes.length === 0 ? (
                <Alert>
                  <AlertTitle>{t({ ko: '노드 없음', en: 'No nodes' })}</AlertTitle>
                  <AlertDescription>{t({ ko: '아직 로드된 커스텀 노드가 없어. 스캐폴드로 하나 만들거나 폴더를 추가한 뒤 재스캔해.', en: 'There are no loaded custom nodes yet. Create one with a scaffold or add a folder, then rescan.' })}</AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2.5">
                  {loadedNodes.map((node) => {
                    const isSelected = selectedTestKey === node.manifest.key
                    return (
                      <div
                        key={node.manifest.key}
                        className="rounded-sm border border-border bg-surface-low px-3 py-2.5 transition-colors hover:border-primary/35"
                        style={isSelected ? { borderColor: 'var(--color-primary)' } : undefined}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{node.manifest.name}</span>
                              {isSelected ? <Badge variant="secondary">{t({ ko: '선택됨', en: 'Selected' })}</Badge> : null}
                              <Badge variant="outline">{node.manifest.key}</Badge>
                              <Badge variant="outline">{node.manifest.entry}</Badge>
                            </div>
                            {node.manifest.description ? <div className="text-xs text-muted-foreground">{node.manifest.description}</div> : null}
                            <div className="text-[11px] text-muted-foreground">{node.folderPath}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? 'default' : 'outline'}
                              onClick={() => {
                                setSelectedTestKey(node.manifest.key)
                                setTestResultData(null)
                                setTestResultText('')
                                setInstallResultText('')
                              }}
                            >
                              {isSelected ? t({ ko: '테스트 대상', en: 'Test target' }) : t({ ko: '테스트 선택', en: 'Select for test' })}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void openFolderMutation.mutateAsync(node.manifest.key)}
                              disabled={openFolderMutation.isPending}
                            >
                              {t({ ko: '폴더 열기', en: 'Open folder' })}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await copyTextToClipboard(node.folderPath)
                                  showSnackbar({ message: t({ ko: '폴더 경로를 복사했어.', en: 'Copied the folder path.' }), tone: 'info' })
                                } catch {
                                  showSnackbar({ message: t({ ko: '폴더 경로 복사에 실패했어.', en: 'Failed to copy the folder path.' }), tone: 'error' })
                                }
                              }}
                            >
                              {t({ ko: '경로 복사', en: 'Copy path' })}
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
            <CardContent className="space-y-3">
              <PanelCardHeader
                title={t({ ko: '로드 오류', en: 'Load errors' })}
                description={t({ ko: 'manifest 또는 entry 파일에 문제가 있으면 여기에 보여줘.', en: 'If there is a problem with the manifest or entry file, it appears here.' })}
                actions={<Badge variant="outline">{loadErrors.length}</Badge>}
              />

              {loadErrors.length === 0 ? (
                <Alert>
                  <AlertTitle>{t({ ko: '오류 없음', en: 'No errors' })}</AlertTitle>
                  <AlertDescription>{t({ ko: '현재 감지된 로드 오류는 없어.', en: 'There are currently no detected load errors.' })}</AlertDescription>
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
            <CardContent className="space-y-3">
              <PanelCardHeader title={t({ ko: '새 노드 스캐폴드', en: 'New node scaffold' })} description={t({ ko: '기본 폴더와 starter 파일을 바로 만들어.', en: 'Create the base folder and starter files right away.' })} />

              <div className="grid gap-3">
                <SettingsField label="folder">
                  <Input variant="settings" value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="weather-api" />
                </SettingsField>

                <SettingsField label="node key">
                  <Input variant="settings" value={nodeKey} onChange={(event) => setNodeKey(event.target.value)} placeholder="custom.weather_api" />
                </SettingsField>

                <SettingsField label={t({ ko: '표시 이름', en: 'Display name' })}>
                  <Input variant="settings" value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="Weather API" />
                </SettingsField>

                <SettingsField label={t({ ko: '설명', en: 'Description' })}>
                  <Textarea variant="settings" rows={3} value={nodeDescription} onChange={(event) => setNodeDescription(event.target.value)} placeholder={t({ ko: '선택', en: 'Optional' })} />
                </SettingsField>

                <SettingsField label={t({ ko: '템플릿', en: 'Template' })}>
                  <Select variant="settings" value={scaffoldTemplate} onChange={(event) => setScaffoldTemplate(event.target.value as CustomNodeScaffoldTemplate)}>
                    <option value="empty">{t({ ko: '비어 있음', en: 'Empty' })}</option>
                    <option value="hello_world">{t({ ko: '헬로 월드', en: 'Hello World' })}</option>
                    <option value="http_json">HTTP JSON</option>
                    <option value="image_file">{t({ ko: '이미지 파일', en: 'Image File' })}</option>
                  </Select>
                </SettingsField>
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
                  {scaffoldMutation.isPending ? t({ ko: '생성 중...', en: 'Creating...' }) : t({ ko: '스캐폴드 생성', en: 'Create scaffold' })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <PanelCardHeader
                title={t({ ko: '단건 테스트', en: 'Single test' })}
                description={selectedTestNode ? t({ ko: '{name} 테스트', en: '{name} test' }, { name: selectedTestNode.manifest.name }) : t({ ko: '먼저 테스트할 노드를 선택해.', en: 'Select a node to test first.' })}
              />

              {selectedNodeSourceQuery.data ? (
                <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">{t({ ko: '소스 정보', en: 'Source info' })}</div>
                      <div className="text-xs text-muted-foreground">{t({ ko: '선택한 커스텀 노드의 파일 경로와 manifest 요약이야.', en: 'This shows the selected custom node file paths and a manifest summary.' })}</div>
                    </div>
                    <Badge variant="outline">{selectedNodeSourceQuery.data.sourceHash.slice(0, 12)}</Badge>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <SettingsValueTile label={t({ ko: '폴더', en: 'Folder' })} value={selectedNodeSourceQuery.data.folderPath} valueClassName="break-all text-xs font-medium" />
                    <SettingsValueTile label="manifest" value={selectedNodeSourceQuery.data.manifestPath} valueClassName="break-all text-xs font-medium" />
                    <SettingsValueTile label="entry" value={selectedNodeSourceQuery.data.entryPath} valueClassName="break-all text-xs font-medium" />
                    <SettingsValueTile label="package.json" value={selectedNodeSourceQuery.data.packageJsonPath ?? t({ ko: '없음', en: 'None' })} valueClassName="break-all text-xs font-medium" />
                    <SettingsValueTile label="README" value={selectedNodeSourceQuery.data.readmePath ?? t({ ko: '없음', en: 'None' })} className="md:col-span-2" valueClassName="break-all text-xs font-medium" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void openFolderMutation.mutateAsync(selectedNodeSourceQuery.data.key)} disabled={openFolderMutation.isPending}>
                      {t({ ko: '폴더 열기', en: 'Open folder' })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await copyTextToClipboard(selectedNodeSourceQuery.data.entryPath)
                          showSnackbar({ message: t({ ko: 'entry 경로를 복사했어.', en: 'Copied the entry path.' }), tone: 'info' })
                        } catch {
                          showSnackbar({ message: t({ ko: 'entry 경로 복사에 실패했어.', en: 'Failed to copy the entry path.' }), tone: 'error' })
                        }
                      }}
                    >
                      {t({ ko: 'Entry 경로 복사', en: 'Copy entry path' })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void installDependenciesMutation.mutateAsync(selectedNodeSourceQuery.data.key)}
                      disabled={installDependenciesMutation.isPending || !selectedNodeSourceQuery.data.packageJsonPath}
                    >
                      {installDependenciesMutation.isPending ? t({ ko: 'npm install 중...', en: 'Running npm install...' }) : 'npm install'}
                    </Button>
                  </div>
                  {selectedNodeSourceQuery.data.packageJsonPath ? (
                    <Textarea variant="settings" rows={8} value={installResultText} placeholder={t({ ko: 'npm install 결과가 여기에 보여.', en: 'The npm install result appears here.' })} readOnly />
                  ) : null}
                  <Textarea variant="settings" rows={8} value={stringifyPrettyJson(selectedNodeSourceQuery.data.manifest)} readOnly />
                </div>
              ) : null}

              <SettingsField label={t({ ko: '테스트 입력 JSON', en: 'Test input JSON' })}>
                <Textarea
                  variant="settings"
                  rows={8}
                  value={testInputsText}
                  onChange={(event) => setTestInputsText(event.target.value)}
                  placeholder={"{\n  \"input\": \"value\"\n}"}
                />
              </SettingsField>
              <Button type="button" variant="outline" onClick={() => void testMutation.mutateAsync()} disabled={testMutation.isPending || !selectedTestKey}>
                {testMutation.isPending ? t({ ko: '테스트 실행 중...', en: 'Running test...' }) : t({ ko: '테스트 실행', en: 'Run test' })}
              </Button>

              {previewableImageOutputs.length > 0 ? (
                <div className="space-y-2.5 rounded-sm border border-border/70 bg-surface-low p-3">
                  <div className="text-sm font-medium text-foreground">{t({ ko: '이미지 미리보기', en: 'Image preview' })}</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {previewableImageOutputs.map((output) => (
                      <div key={output.key} className="space-y-2">
                        <div className="text-xs text-muted-foreground">{output.label}</div>
                        <img src={output.value} alt={output.label} className="max-h-56 w-full rounded-sm border border-border/70 object-contain bg-black/20" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {filePathOutputs.length > 0 ? (
                <Alert>
                  <AlertTitle>{t({ ko: '파일 경로 이미지 출력', en: 'File-path image output' })}</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 text-sm">
                      <div>{t({ ko: '이 테스트 결과는 이미지 포트를 파일 경로 문자열로 반환했어. 현재 패널에서는 경로만 보여주고, 실제 그래프 실행 시 artifact로 저장돼.', en: 'This test result returned an image port as a file-path string. This panel only shows the path, and the real graph run saves it as an artifact.' })}</div>
                      {filePathOutputs.map((output) => (
                        <div key={output.key} className="font-mono text-xs text-muted-foreground">
                          {output.label}: {output.value}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              {testResultData?.logs.length ? (
                <div className="space-y-2 rounded-sm border border-border/70 bg-surface-low p-3">
                  <div className="text-sm font-medium text-foreground">{t({ ko: '실행 로그', en: 'Execution logs' })}</div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {testResultData.logs.map((logItem, index) => (
                      <div key={`${index}:${logItem.message}`}>
                        <span className="font-medium text-foreground">[{logItem.level ?? 'info'}]</span> {logItem.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <SettingsField label={t({ ko: '테스트 결과', en: 'Test result' })}>
                <Textarea variant="settings" rows={14} value={testResultText} placeholder={t({ ko: '테스트 결과가 여기에 보여.', en: 'The test result appears here.' })} readOnly />
              </SettingsField>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
