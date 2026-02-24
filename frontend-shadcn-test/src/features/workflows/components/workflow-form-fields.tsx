import { useEffect, useState } from 'react'
import { ChevronDown, Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MarkedField, Workflow } from '@/services/workflow-api'
import { customDropdownListApi } from '@/services/custom-dropdown-list-api'
import { ensureAbsoluteUrl } from '@/utils/backend'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface WorkflowFormFieldsProps {
  workflow: Workflow
  formData: Record<string, unknown>
  onFieldChange: (fieldId: string, value: unknown) => void
  promptData: Record<string, unknown>
}

export function WorkflowFormFields({ workflow, formData, onFieldChange, promptData }: WorkflowFormFieldsProps) {
  const { t } = useTranslation(['workflows'])
  const [dropdownOptions, setDropdownOptions] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const loadDropdownLists = async () => {
      if (!workflow.marked_fields) return
      const optionsMap: Record<string, string[]> = {}
      for (const field of workflow.marked_fields) {
        if (field.type === 'select' && field.dropdown_list_name) {
          try {
            const response = await customDropdownListApi.getListByName(field.dropdown_list_name)
            optionsMap[field.id] = response.success && response.data ? response.data.items : (field.options ?? [])
          } catch {
            optionsMap[field.id] = field.options ?? []
          }
        } else if (field.type === 'select') {
          optionsMap[field.id] = field.options ?? []
        }
      }
      setDropdownOptions(optionsMap)
    }
    void loadDropdownLists()
  }, [workflow])

  const textValue = (value: unknown): string => (value === undefined || value === null ? '' : String(value))

  const renderField = (field: MarkedField) => {
    const value = textValue(formData[field.id])

    if (field.type === 'textarea') {
      return <div key={field.id} className="space-y-1">{field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}<Textarea rows={4} value={value} onChange={(event) => onFieldChange(field.id, event.target.value)} placeholder={field.placeholder} /></div>
    }

    if (field.type === 'number') {
      return <div key={field.id} className="space-y-1">{field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}<Input type="number" value={value} min={field.min} max={field.max} step={field.step || 1} onChange={(event) => onFieldChange(field.id, event.target.value)} placeholder={field.placeholder} /></div>
    }

    if (field.type === 'select') {
      const options = dropdownOptions[field.id] ?? field.options ?? []
      return (
        <div key={field.id} className="space-y-1">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onFieldChange(field.id, event.target.value)}>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{field.description || (field.dropdown_list_name ? `List: ${field.dropdown_list_name}` : '')}</p>
        </div>
      )
    }

    if (field.type === 'image') {
      return (
        <div key={field.id} className="space-y-2">
          <p className="text-sm font-medium">{field.label}</p>
          {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
          <div className="flex gap-2">
            <Input value={value} onChange={(event) => onFieldChange(field.id, event.target.value)} placeholder={t('workflows:form.selectImage')} />
            <Button type="button" variant="outline" onClick={() => onFieldChange(field.id, value)}><Image className="h-4 w-4" /></Button>
          </div>
          {value ? <img src={value.startsWith('data:') ? value : ensureAbsoluteUrl(value)} alt={field.label} className="max-h-[200px] w-full rounded-md border object-contain" /> : null}
        </div>
      )
    }

    return <div key={field.id} className="space-y-1">{field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}<Input value={value} onChange={(event) => onFieldChange(field.id, event.target.value)} placeholder={field.placeholder} /></div>
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t('workflows:generate.settingsTitle')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
          <div className="space-y-3">{workflow.marked_fields.map((field) => renderField(field))}</div>
        ) : (
          <Alert><AlertDescription>{t('workflows:alerts.noConfigurableFields')}</AlertDescription></Alert>
        )}

        <details className="rounded-md border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium"><ChevronDown className="h-4 w-4" />{t('workflows:generate.previewTitle')}</summary>
          <pre className="max-h-[400px] overflow-auto border-t p-2 text-xs">{JSON.stringify(promptData, null, 2)}</pre>
        </details>
      </CardContent>
    </Card>
  )
}
