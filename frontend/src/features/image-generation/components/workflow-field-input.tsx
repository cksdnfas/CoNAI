import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api'
import { FormField, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (file?: File) => Promise<void>
}

/** Render a single marked-field editor for a ComfyUI workflow. */
export function WorkflowFieldInput({ field, value, onChange, onImageChange }: WorkflowFieldInputProps) {
  const hint = [field.type, field.required ? 'required' : null].filter(Boolean).join(' · ')

  if (field.type === 'textarea') {
    return (
      <FormField label={field.label} hint={[hint, '`++` wildcard'].filter(Boolean).join(' · ')}>
        <WildcardInlinePickerField
          tool="comfyui"
          multiline
          rows={4}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder || ''}
          onChange={onChange}
        />
        {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
      </FormField>
    )
  }

  if (field.type === 'select') {
    return (
      <FormField label={field.label} hint={hint}>
        <Select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">선택</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
      </FormField>
    )
  }

  if (field.type === 'image') {
    const imageValue = typeof value === 'string' ? null : value

    return (
      <FormField label={field.label} hint={hint}>
        <div className="space-y-3">
          <Input type="file" accept="image/*" onChange={(event) => void onImageChange(event.target.files?.[0])} />
          {imageValue ? (
            <div className="space-y-2 rounded-sm bg-surface-low p-3">
              <div className="text-xs text-muted-foreground">{imageValue.fileName}</div>
              <img src={imageValue.dataUrl} alt={field.label} className="max-h-40 rounded-sm border border-border object-contain" />
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => void onImageChange()}>
                  이미지 제거
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
      </FormField>
    )
  }

  if (field.type === 'text') {
    return (
      <FormField label={field.label} hint={[hint, '`++` wildcard'].filter(Boolean).join(' · ')}>
        <WildcardInlinePickerField
          tool="comfyui"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder || ''}
          onChange={onChange}
        />
        {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
      </FormField>
    )
  }

  return (
    <FormField label={field.label} hint={hint}>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        min={field.type === 'number' ? field.min : undefined}
        max={field.type === 'number' ? field.max : undefined}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder || ''}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
    </FormField>
  )
}
