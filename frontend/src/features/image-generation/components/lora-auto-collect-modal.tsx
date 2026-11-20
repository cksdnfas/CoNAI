import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field, FieldInfo } from '@/components/ui/field'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import type { LoraFileData, LoraScanRequest } from '@/lib/api-wildcards'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

type LoraAutoCollectModalProps = {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: LoraScanRequest) => Promise<void>
}

type MatchingMode = 'filename' | 'common'

type RelativeFile = File & {
  webkitRelativePath?: string
}

function getRelativeFilePath(file: RelativeFile) {
  return file.webkitRelativePath || file.name
}

function getFolderPath(relativePath: string) {
  return relativePath.split('/').slice(0, -1).join('/')
}

function isLoraModelFile(file: RelativeFile) {
  return file.name.toLocaleLowerCase().endsWith('.safetensors')
}

function splitPromptLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function prepareLoraSelection(files: RelativeFile[]) {
  const byPath = new Map(files.map(file => [getRelativeFilePath(file), file]))
  const models = files.filter(isLoraModelFile)
  const cache = new Map<RelativeFile, Promise<string[]>>()
  const read = (file: RelativeFile) => {
    let lines = cache.get(file)
    if (!lines) {
      lines = file.text().then(splitPromptLines).catch(error => { cache.delete(file); throw error })
      cache.set(file, lines)
    }
    return lines
  }
  return async (mode: MatchingMode, commonName: string, signal: AbortSignal) => {
    const records: LoraFileData[] = []
    for (const file of models) {
      signal.throwIfAborted()
      const relative = getRelativeFilePath(file)
      const parts = relative.split('/')
      const dir = getFolderPath(relative)
      const common = commonName ? byPath.get(dir ? `${dir}/${commonName}` : commonName) : undefined
      const paired = byPath.get(relative.replace(/\.safetensors$/i, '.txt'))
      const candidates = mode === 'common' ? [common, paired] : [paired, common]
      let promptLines: string[] = []
      for (const candidate of candidates) {
        if (!candidate) continue
        signal.throwIfAborted()
        promptLines = await read(candidate)
        if (promptLines.length) break
      }
      records.push({ folderName: parts.slice(1, -1).join('/') || parts[0] || 'root', loraName: file.name.replace(/\.safetensors$/i, ''), promptLines })
    }
    return records
  }
}

export function LoraAutoCollectModal(props: LoraAutoCollectModalProps) {
  return props.open ? <LoraFolderForm {...props} /> : null
}

function LoraFolderForm({ isSubmitting = false, onClose, onSubmit }: LoraAutoCollectModalProps) {
  const { t, formatNumber } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<RelativeFile[]>([])
  const [loraWeight, setLoraWeight] = useState('1.0')
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number')
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('filename')
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt')
  const [formError, setFormError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const read = useMemo(() => prepareLoraSelection(selectedSourceFiles), [selectedSourceFiles])
  const request = useMemo(() => ({ read, matchingMode, commonName: commonTextFilename.trim() }), [read, matchingMode, commonTextFilename])
  const [prepared, setPrepared] = useState<{ request: typeof request; files: LoraFileData[]; error?: unknown } | null>(null)
  const current = prepared?.request === request ? prepared : null
  const selectedFiles = current?.files ?? []
  const isPreparingFiles = selectedSourceFiles.length > 0 && !current
  const busy = isSubmitting || publishing
  const previewSummary = selectedFiles.slice(0, 5)
  const message = formError || (current && 'error' in current
    ? current.error instanceof Error ? current.error.message : t({ ko: '폴더 파일을 읽는 중 오류가 났어.', en: 'An error occurred while reading the folder files.' })
    : null)

  useEffect(() => {
    if (!selectedSourceFiles.length) return
    const controller = new AbortController()
    void request.read(request.matchingMode, request.commonName, controller.signal).then(files => {
      if (!controller.signal.aborted) setPrepared({ request, files })
    }, error => {
      if (!controller.signal.aborted) setPrepared({ request, files: [], error })
    })
    return () => controller.abort()
  }, [request, selectedSourceFiles])

  const handlePickFolder = () => {
    inputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as RelativeFile[]
    if (files.length === 0) {
      return
    }

    setSelectedSourceFiles(files)
    setFormError(null)
    event.target.value = ''
  }

  const handleMatchingModeChange = (nextMode: MatchingMode) => {
    setMatchingMode(nextMode)
    setFormError(null)
  }

  const handleCommonTextFilenameChange = (nextFilename: string) => {
    setCommonTextFilename(nextFilename)
    setFormError(null)
  }

  const handleSubmit = async () => {
    if (busy || isPreparingFiles || (current && 'error' in current)) return
    if (selectedSourceFiles.length === 0) {
      setFormError(t({ ko: '먼저 LoRA 폴더를 골라줘.', en: 'Choose a LoRA folder first.' }))
      return
    }

    const parsedWeight = Number(loraWeight)
    if (!Number.isFinite(parsedWeight) || parsedWeight < 0.1 || parsedWeight > 2.0) {
      setFormError(t({ ko: 'LoRA weight는 0.1에서 2.0 사이여야 해.', en: 'LoRA weight must be between 0.1 and 2.0.' }))
      return
    }

    setFormError(null)
    setPublishing(true)

    try {
      if (selectedFiles.length === 0) {
        setFormError(t({ ko: '선택한 폴더에서 LoRA 파일을 찾지 못했어.', en: 'Could not find LoRA files in the selected folder.' }))
        return
      }

      await onSubmit({
        loraFiles: selectedFiles,
        loraWeight: parsedWeight,
        duplicateHandling,
        matchingMode,
        commonTextFilename,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t({ ko: '자동 수집 준비 중 오류가 났어.', en: 'An error occurred while preparing auto-collection.' }))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) {
          onClose()
        }
      }}
      title={t({ ko: 'LoRA 자동 수집', en: 'LoRA auto-collection' })}
      size="lg"
    >
      <ModalBody spacing="lg">
        {message ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '수집 준비 실패', en: 'Collection preparation failed' })}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <input ref={inputRef} type="file" className="hidden" multiple {...{ webkitdirectory: '', directory: '' }} onChange={handleFileChange} />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePickFolder}
              disabled={busy}
            >
              {t({ ko: '폴더 고르기', en: 'Choose folder' })}
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">{t({ ko: 'LoRA {count}개 선택됨', en: '{count} LoRA files selected' }, { count: formatNumber(selectedFiles.length) })}</span>
            <FieldInfo>{t({ ko: '폴더 안의 .safetensors, 같은 이름의 .txt, 공용 txt를 읽어 자동 수집 LoRA 트리를 다시 만들어.', en: 'Reads .safetensors, same-name .txt and the shared txt in the folder, then rebuilds the auto-collected LoRA tree.' })}</FieldInfo>
            {isPreparingFiles ? <div className="text-sm text-muted-foreground">{t({ ko: '폴더 구조 읽는 중…', en: 'Reading folder structure…' })}</div> : null}
          </div>

          {selectedFiles.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {previewSummary.map((file) => (
                <li key={`${file.folderName}/${file.loraName}`}>
                  <span className="font-medium">{file.loraName}</span>
                  <span className="opacity-80"> · {file.folderName || 'root'}</span>
                  {file.promptLines.length > 0 ? <span className="opacity-80"> · {t({ ko: '프롬프트 {count}줄', en: '{count} prompt lines' }, { count: formatNumber(file.promptLines.length) })}</span> : null}
                </li>
              ))}
              {selectedFiles.length > previewSummary.length ? <li>{t({ ko: '외 {count}개 더 있어.', en: '{count} more.' }, { count: formatNumber(selectedFiles.length - previewSummary.length) })}</li> : null}
            </ul>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t({ ko: '기본 LoRA weight', en: 'Default LoRA weight' })}>
            <NumberStepperInput min="0.1" max="2.0" step="0.1" value={loraWeight} onValueCommit={(nextValue) => setLoraWeight(nextValue)} />
          </Field>

          <Field label={t({ ko: '중복 이름 처리', en: 'Duplicate name handling' })}>
            <Select value={duplicateHandling} onChange={(event) => setDuplicateHandling(event.target.value as 'number' | 'parent')}>
              <option value="number">{t({ ko: '숫자 suffix 붙이기', en: 'Append numeric suffix' })}</option>
              <option value="parent">{t({ ko: '부모 경로 이름 붙이기', en: 'Append parent path name' })}</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t({ ko: '프롬프트 매칭 모드', en: 'Prompt matching mode' })}>
            <Select value={matchingMode} onChange={(event) => handleMatchingModeChange(event.target.value as MatchingMode)}>
              <option value="filename">{t({ ko: '개별 txt 먼저, 없으면 공용 txt', en: 'Individual txt first, then shared txt' })}</option>
              <option value="common">{t({ ko: '공용 txt 먼저, 없으면 개별 txt', en: 'Shared txt first, then individual txt' })}</option>
            </Select>
          </Field>

          <Field label={t({ ko: '공용 txt 파일명', en: 'Shared txt filename' })}>
            <Input value={commonTextFilename} onChange={(event) => handleCommonTextFilenameChange(event.target.value)} placeholder={t({ ko: '예: add.txt', en: 'e.g. add.txt' })} />
          </Field>
        </div>

        <EditorFooter onSave={() => void handleSubmit()} canSave={selectedSourceFiles.length > 0 && !!current && !('error' in current)} saving={busy || isPreparingFiles} saveLabel={t({ ko: '다시 만들기', en: 'Rebuild' })} />
      </ModalBody>
    </Modal>
  )
}
