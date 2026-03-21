import type { Dispatch, SetStateAction } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { NAICharacterPrompt, NAIParams } from '../types/nai.types'

interface NAICharacterPromptsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

function createCharacterPrompt(index: number): NAICharacterPrompt {
  const slotCount = Math.max(index + 2, 2)
  const spread = slotCount === 1 ? 0.5 : index / (slotCount - 1)

  return {
    id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    prompt: '',
    uc: '',
    center_x: Number(spread.toFixed(2)),
    center_y: 0.5,
  }
}

export default function NAICharacterPrompts({ params, onChange, disabled = false }: NAICharacterPromptsProps) {
  const supportsCharacterPrompts = params.model.includes('nai-diffusion-4')

  if (!supportsCharacterPrompts) {
    return null
  }

  const updateCharacterPrompt = (id: string, patch: Partial<NAICharacterPrompt>) => {
    onChange((previous) => ({
      ...previous,
      character_prompts: previous.character_prompts.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    }))
  }

  const addCharacterPrompt = () => {
    onChange((previous) => ({
      ...previous,
      character_prompts: [...previous.character_prompts, createCharacterPrompt(previous.character_prompts.length)],
    }))
  }

  const removeCharacterPrompt = (id: string) => {
    onChange((previous) => ({
      ...previous,
      character_prompts: previous.character_prompts.filter((entry) => entry.id !== id),
    }))
  }

  return (
    <section className="space-y-4 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Character Prompts</h3>
          <p className="text-xs text-muted-foreground">여러 캐릭터를 분리해 넣을 때 쓰는 V4 계열 프롬프트 레이어이옵니다.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addCharacterPrompt} disabled={disabled}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {params.character_prompts.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          아직 추가된 캐릭터가 없사옵니다.
        </div>
      ) : (
        <div className="space-y-3">
          {params.character_prompts.map((entry, index) => (
            <div key={entry.id} className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Character {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeCharacterPrompt(entry.id)}
                  disabled={disabled}
                  aria-label={`Remove character ${index + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <label className="grid gap-2 text-sm">
                <span>Character prompt</span>
                <Textarea
                  rows={3}
                  value={entry.prompt}
                  disabled={disabled}
                  onChange={(event) => updateCharacterPrompt(entry.id, { prompt: event.target.value })}
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span>Character negative prompt</span>
                <Textarea
                  rows={2}
                  value={entry.uc}
                  disabled={disabled}
                  onChange={(event) => updateCharacterPrompt(entry.id, { uc: event.target.value })}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span>Position X</span>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={entry.center_x}
                    disabled={disabled}
                    onChange={(event) => updateCharacterPrompt(entry.id, { center_x: Number(event.target.value) })}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span>Position Y</span>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={entry.center_y}
                    disabled={disabled}
                    onChange={(event) => updateCharacterPrompt(entry.id, { center_y: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
