import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Save, Upload } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { workflowApi, type MarkedField, type Workflow } from '@/services/workflow-api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkedFieldsList, useMarkedFieldValidation } from './components/marked-fields'
import EnhancedWorkflowGraphViewer from './components/enhanced-workflow-graph-viewer'
import WorkflowJsonViewer from './components/workflow-json-viewer'

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybe = error as { response?: { data?: { error?: string } }; message?: string }
    return maybe.response?.data?.error || maybe.message || 'Unknown error'
  }
  return 'Unknown error'
}

export function WorkflowFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isEditMode = Boolean(id)
  const { t } = useTranslation(['workflows'])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workflowJson, setWorkflowJson] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [markedFields, setMarkedFields] = useState<MarkedField[]>([])
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonTabValue, setJsonTabValue] = useState<'editor' | 'graph' | 'json'>('editor')

  const validation = useMarkedFieldValidation(markedFields)

  useEffect(() => {
    const load = async () => {
      if (!id) return
      try {
        setLoading(true)
        const response = await workflowApi.getWorkflow(parseInt(id, 10))
        const workflow: Workflow = response.data
        setName(workflow.name)
        setDescription(workflow.description || '')
        setWorkflowJson(workflow.workflow_json)
        setIsActive(workflow.is_active)
        setMarkedFields(workflow.marked_fields || [])
      } catch (e) {
        setError(getErrorMessage(e))
      } finally {
        setLoading(false)
      }
    }
    if (isEditMode) void load()
  }, [id, isEditMode])

  const handleWorkflowJsonChange = (value: string) => {
    setWorkflowJson(value)
    if (!value.trim()) return setJsonError(null)
    try { JSON.parse(value); setJsonError(null) } catch { setJsonError(t('workflows:form.invalidJson')) }
  }

  const handleSubmit = async () => {
    if (!name.trim()) return setError(t('workflows:form.nameRequired'))
    if (!workflowJson.trim()) return setError(t('workflows:form.jsonRequired'))
    if (jsonError) return setError(t('workflows:form.validateJson'))
    try {
      setSaving(true)
      setError(null)
      const data = { name: name.trim(), description: description.trim() || undefined, workflow_json: workflowJson, marked_fields: markedFields.length ? markedFields : undefined, is_active: isActive }
      if (isEditMode && id) await workflowApi.updateWorkflow(parseInt(id, 10), data)
      else await workflowApi.createWorkflow(data)
      setSuccess(isEditMode ? t('workflows:alerts.updated') : t('workflows:alerts.created'))
      window.setTimeout(() => navigate('/image-generation?tab=workflows'), 1200)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleParameterRightClick = (
    nodeId: string,
    paramKey: string,
    paramValue: unknown,
    paramType: string,
    nodeTitle: string,
    classType: string,
  ) => {
    const jsonPath = `${nodeId}.inputs.${paramKey}`
    const isDuplicate = markedFields.some((field) => field.jsonPath === jsonPath)

    if (isDuplicate) {
      setError(`Parameter "${paramKey}" from node ${nodeId} is already in Marked Fields`)
      window.setTimeout(() => setError(null), 3000)
      return
    }

    let fieldType: 'text' | 'number' | 'textarea' = 'text'
    if (typeof paramValue === 'number') {
      fieldType = 'number'
    } else if (typeof paramValue === 'string' && paramValue.length > 100) {
      fieldType = 'textarea'
    }

    const cleanTitle = nodeTitle
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')

    const autoLabel = `#${nodeId}_${cleanTitle}(${paramKey.toUpperCase()})`
    const newField: MarkedField = {
      id: `field_${Date.now()}`,
      label: autoLabel,
      jsonPath,
      type: fieldType,
      required: false,
    }

    setMarkedFields((prev) => [...prev, newField])
    setSuccess(`Added "${paramKey}" (${paramType}) from Node ${nodeId} [${classType}] to Marked Fields`)
    window.setTimeout(() => setSuccess(null), 3000)
  }

  if (loading) return <div className="flex min-h-[400px] items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" /></div>

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 p-3">
      <div className="flex items-center gap-2"><Button type="button" variant="ghost" size="icon-sm" onClick={() => navigate('/image-generation?tab=workflows')}><ArrowLeft className="h-4 w-4" /></Button><h1 className="text-2xl font-semibold tracking-tight">{isEditMode ? t('workflows:page.editTitle') : t('workflows:page.createTitle')}</h1></div>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}

      <Card><CardHeader><CardTitle>{t('workflows:form.basicInfo')}</CardTitle></CardHeader><CardContent className="space-y-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workflows:form.workflowName')} /><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('workflows:form.description')} /><label className="flex items-center justify-between rounded border p-2 text-sm">{t('workflows:form.activate')}<input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /></label></CardContent></Card>

      <Card>
        <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>{t('workflows:form.workflowJson')}</CardTitle><Button type="button" variant="outline" size="sm" asChild><label><Upload className="h-4 w-4" />{t('workflows:form.uploadFile')}<input type="file" accept=".json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { if (typeof event.target?.result === 'string') handleWorkflowJsonChange(event.target.result) }; reader.readAsText(file) }} /></label></Button></div></CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={jsonTabValue} onValueChange={(value) => setJsonTabValue(value as 'editor' | 'graph' | 'json')}>
            <TabsList>
              <TabsTrigger value="editor">{t('workflows:workflowViewer.editorView')}</TabsTrigger>
              <TabsTrigger value="graph" disabled={!workflowJson || Boolean(jsonError)}>{t('workflows:workflowViewer.graphView')}</TabsTrigger>
              <TabsTrigger value="json" disabled={!workflowJson || Boolean(jsonError)}>{t('workflows:workflowViewer.jsonView')}</TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="space-y-2">
              <Textarea rows={15} className="font-mono text-sm" value={workflowJson} onChange={(e) => handleWorkflowJsonChange(e.target.value)} />
              {jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
              {workflowJson && !jsonError ? <Badge>{t('workflows:form.jsonCharCount', { count: JSON.stringify(JSON.parse(workflowJson)).length })}</Badge> : null}
            </TabsContent>

            <TabsContent value="graph">
              {workflowJson && !jsonError ? (
                <div className="h-[600px] overflow-hidden rounded-md border">
                  <EnhancedWorkflowGraphViewer workflowJson={workflowJson} onParameterRightClick={handleParameterRightClick} />
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="json">
              {workflowJson && !jsonError ? (
                <div className="h-[600px] overflow-auto rounded-md border p-2">
                  <WorkflowJsonViewer workflowJson={workflowJson} />
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center justify-between"><CardTitle>{t('workflows:markedFields.sectionTitle')}</CardTitle><Button type="button" size="sm" onClick={() => setMarkedFields((prev) => [...prev, { id: `field_${Date.now()}`, label: '', jsonPath: '', type: 'text', required: false }])}><Plus className="h-4 w-4" />{t('workflows:markedFields.addField')}</Button></div></CardHeader>
        <CardContent className="space-y-2">{validation.errorCount > 0 || validation.warningCount > 0 ? <Alert variant={validation.errorCount > 0 ? 'destructive' : 'default'}><AlertDescription>{validation.errorCount > 0 ? t('workflows:markedFields.validationErrors', { count: validation.errorCount }) : t('workflows:markedFields.validationWarnings', { count: validation.warningCount })}</AlertDescription></Alert> : null}<MarkedFieldsList fields={markedFields} onFieldsChange={setMarkedFields} onUpdateField={(index, updates) => setMarkedFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...updates } : field)))} onDeleteField={(index) => setMarkedFields((prev) => prev.filter((_, i) => i !== index))} /></CardContent>
      </Card>

      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => navigate('/image-generation?tab=workflows')} disabled={saving}>{t('workflows:actions.cancel')}</Button><Button type="button" onClick={() => void handleSubmit()} disabled={saving || Boolean(jsonError) || !name.trim() || !workflowJson.trim()}>{saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" /> : <Save className="h-4 w-4" />}{saving ? t('workflows:actions.saving') : isEditMode ? t('workflows:actions.update') : t('workflows:actions.create')}</Button></div>
    </div>
  )
}
