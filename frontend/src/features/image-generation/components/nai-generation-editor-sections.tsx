import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { StoredNaiCharacterReferenceAsset, StoredNaiVibeAsset } from '@/lib/api-image-generation-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useI18n } from '@/i18n'
import {
  FormField,
  NAI_ACTION_OPTIONS,
  NAI_MODEL_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  type NAIFormDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiCharacterPositionBoard } from './nai-character-position-board'
import { NaiControllerInsetBlock, NaiControllerSection, NaiPromptSection } from './nai-generation-panel-sections'
import { NaiReferencesSection } from './nai-references-section'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiVibesSection } from './nai-vibes-section'
import { PromptToggleField } from './prompt-toggle-field'

/** Render the main editable NAI form sections while the parent panel handles data wiring and modals. */
export function NaiGenerationEditorSections({
  naiForm,
  setNaiForm,
  selectedCharacterIndex,
  setSelectedCharacterIndex,
  supportsCharacterPrompts,
  supportsCharacterReference,
  canUseCharacterPositions,
  useCharacterPositions,
  savedCharacterReferenceSearch,
  setSavedCharacterReferenceSearch,
  filteredSavedCharacterReferences,
  savedCharacterReferencesLoading,
  savedVibeSearch,
  setSavedVibeSearch,
  filteredSavedVibes,
  savedVibesLoading,
  naiConnected,
  encodingVibeIndex,
  handleNaiFieldChange,
  handleResolutionPresetChange,
  handleOpenImageEditor,
  handleNaiImageChange,
  handleAddCharacterPrompt,
  handleCharacterPromptChange,
  handleRemoveCharacterPrompt,
  handleAddCharacterReference,
  handleCharacterReferenceFieldChange,
  handleCharacterReferenceImageChange,
  handleRemoveCharacterReference,
  handleOpenCharacterReferenceSaveModal,
  handleLoadCharacterReferenceFromStore,
  handleOpenEditCharacterReferenceFromStore,
  handleDeleteCharacterReferenceFromStore,
  handleAddVibe,
  handleVibeFieldChange,
  handleVibeImageChange,
  handleRemoveVibe,
  handleOpenVibeSaveModal,
  handleLoadVibeFromStore,
  handleOpenEditVibeFromStore,
  handleDeleteVibeFromStore,
  actionSection,
  showActionSection,
}: {
  naiForm: NAIFormDraft
  setNaiForm: Dispatch<SetStateAction<NAIFormDraft>>
  selectedCharacterIndex: number | null
  setSelectedCharacterIndex: Dispatch<SetStateAction<number | null>>
  supportsCharacterPrompts: boolean
  supportsCharacterReference: boolean
  canUseCharacterPositions: boolean
  useCharacterPositions: boolean
  savedCharacterReferenceSearch: string
  setSavedCharacterReferenceSearch: Dispatch<SetStateAction<string>>
  filteredSavedCharacterReferences: StoredNaiCharacterReferenceAsset[]
  savedCharacterReferencesLoading: boolean
  savedVibeSearch: string
  setSavedVibeSearch: Dispatch<SetStateAction<string>>
  filteredSavedVibes: StoredNaiVibeAsset[]
  savedVibesLoading: boolean
  naiConnected: boolean
  encodingVibeIndex: number | null
  handleNaiFieldChange: (field: 'prompt' | 'negativePrompt' | 'model' | 'action' | 'sampler' | 'scheduler' | 'width' | 'height' | 'steps' | 'scale' | 'samples' | 'seed' | 'strength' | 'noise', value: string) => void
  handleResolutionPresetChange: (presetKey: string) => void
  handleOpenImageEditor: () => void
  handleNaiImageChange: (field: 'sourceImage' | 'maskImage', image?: SelectedImageDraft) => void
  handleAddCharacterPrompt: () => void
  handleCharacterPromptChange: (index: number, field: 'prompt' | 'uc' | 'centerX' | 'centerY', value: string) => void
  handleRemoveCharacterPrompt: (index: number) => void
  handleAddCharacterReference: () => void
  handleCharacterReferenceFieldChange: (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => void
  handleCharacterReferenceImageChange: (index: number, image?: SelectedImageDraft) => void
  handleRemoveCharacterReference: (index: number) => void
  handleOpenCharacterReferenceSaveModal: (index: number) => void
  handleLoadCharacterReferenceFromStore: (assetId: string) => Promise<void>
  handleOpenEditCharacterReferenceFromStore: (assetId: string) => void
  handleDeleteCharacterReferenceFromStore: (assetId: string) => Promise<void>
  handleAddVibe: () => void
  handleVibeFieldChange: (index: number, field: 'strength' | 'informationExtracted', value: string) => void
  handleVibeImageChange: (index: number, image?: SelectedImageDraft) => void
  handleRemoveVibe: (index: number) => void
  handleOpenVibeSaveModal: (index: number) => void
  handleLoadVibeFromStore: (assetId: string) => Promise<void>
  handleOpenEditVibeFromStore: (assetId: string) => void
  handleDeleteVibeFromStore: (assetId: string) => Promise<void>
  actionSection: ReactNode
  showActionSection: boolean
}) {
  const { t } = useI18n()

  return (
    <>
      <NaiPromptSection
        prompt={naiForm.prompt}
        negativePrompt={naiForm.negativePrompt}
        onPromptChange={(value) => handleNaiFieldChange('prompt', value)}
        onNegativePromptChange={(value) => handleNaiFieldChange('negativePrompt', value)}
      />

      <NaiControllerSection
        heading="Character Prompt"
        actions={(
          <>
            <Badge variant="outline">{naiForm.characters.length}</Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={handleAddCharacterPrompt}
              disabled={!supportsCharacterPrompts}
              aria-label={t('image-generation.components.nai.generation.editor.sections.add.character')}
              title={t('image-generation.components.nai.generation.editor.sections.add.character')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        {!supportsCharacterPrompts ? (
          <div className="text-xs text-[#ffb4ab]">{t('image-generation.components.nai.generation.editor.sections.character.prompt.is.not.available.for.the')}</div>
        ) : (
          <>
            <ToggleRow variant="detail" className="justify-between px-3 py-2.5">
              <div className="text-sm font-medium text-foreground">AI's Choice</div>
              <input
                type="checkbox"
                checked={naiForm.characterPositionAiChoice}
                disabled={!canUseCharacterPositions}
                onChange={(event) => setNaiForm((current) => ({
                  ...current,
                  characterPositionAiChoice: event.target.checked,
                }))}
              />
            </ToggleRow>

            {useCharacterPositions ? (
              <NaiControllerInsetBlock>
                <NaiCharacterPositionBoard
                  characters={naiForm.characters.map((character, index) => ({
                    label: `Character ${index + 1}`,
                    centerX: character.centerX,
                    centerY: character.centerY,
                  }))}
                  selectedIndex={selectedCharacterIndex}
                  onSelectIndex={setSelectedCharacterIndex}
                  onPositionChange={(index, centerX, centerY) => {
                    handleCharacterPromptChange(index, 'centerX', centerX)
                    handleCharacterPromptChange(index, 'centerY', centerY)
                  }}
                />
              </NaiControllerInsetBlock>
            ) : null}

            <div className="overflow-hidden rounded-sm border border-border/85 divide-y divide-border/85 bg-surface-low/40">
              {naiForm.characters.map((character, index) => (
                <div
                  key={`nai-character-${index}`}
                  className={index === selectedCharacterIndex
                    ? 'space-y-3 bg-surface-low/90 px-3 py-3 ring-1 ring-inset ring-accent/45'
                    : 'space-y-3 px-3 py-3'}
                  onClick={() => setSelectedCharacterIndex(index)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
                      <Badge variant="outline">{useCharacterPositions ? `${character.centerX} · ${character.centerY}` : "AI's Choice"}</Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRemoveCharacterPrompt(index)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('image-generation.components.nai.common.remove')}
                    </Button>
                  </div>

                  <PromptToggleField
                    tool="nai"
                    positiveValue={character.prompt}
                    negativeValue={character.uc}
                    onPositiveChange={(value) => handleCharacterPromptChange(index, 'prompt', value)}
                    onNegativeChange={(value) => handleCharacterPromptChange(index, 'uc', value)}
                    positiveRows={4}
                    negativeRows={3}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </NaiControllerSection>

      <NaiControllerSection heading="Settings">
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Core</div>
            <NaiControllerInsetBlock>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-3">
                  <FormField label="Model">
                    <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                      {NAI_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <FormField label="Action">
                  <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                    {NAI_ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </FormField>
              </div>
            </NaiControllerInsetBlock>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sampling</div>
            <NaiControllerInsetBlock>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FormField label="Sampler">
                  <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                    {NAI_SAMPLER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Scheduler">
                  <Select value={naiForm.scheduler} onChange={(event) => handleNaiFieldChange('scheduler', event.target.value)}>
                    {NAI_SCHEDULER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Steps">
                  <Input type="number" min={1} max={100} value={naiForm.steps} onChange={(event) => handleNaiFieldChange('steps', event.target.value)} />
                </FormField>

                <FormField label="CFG Scale">
                  <Input type="number" min={1} max={20} step={0.1} value={naiForm.scale} onChange={(event) => handleNaiFieldChange('scale', event.target.value)} />
                </FormField>
              </div>
            </NaiControllerInsetBlock>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Output</div>
            <NaiControllerInsetBlock>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <FormField label="Preset">
                  <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
                    {NAI_RESOLUTION_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>{preset.label}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </Select>
                </FormField>

                <FormField label="Width">
                  <Input type="number" min={64} step={64} value={naiForm.width} onChange={(event) => handleNaiFieldChange('width', event.target.value)} />
                </FormField>

                <FormField label="Height">
                  <Input type="number" min={64} step={64} value={naiForm.height} onChange={(event) => handleNaiFieldChange('height', event.target.value)} />
                </FormField>

                <FormField label="Samples">
                  <Input type="number" min={NAI_SAMPLE_COUNT_MIN} max={NAI_SAMPLE_COUNT_MAX} step={1} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                </FormField>

                <FormField label="Seed">
                  <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} />
                </FormField>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Variety+</div>
                  <ToggleRow variant="detail" className="justify-between px-3 py-2.5">
                    <div className="text-sm text-foreground">{t('image-generation.components.nai.generation.editor.sections.use')}</div>
                    <input type="checkbox" checked={naiForm.varietyPlus} onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))} />
                  </ToggleRow>
                </div>
              </div>
            </NaiControllerInsetBlock>
          </div>
        </div>
      </NaiControllerSection>

      {naiForm.action !== 'generate' ? (
        <NaiControllerSection heading="Images">
          <div className="space-y-4">
            <FormField label="Source Image">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <ImageAttachmentPickerButton
                    label={naiForm.sourceImage
                      ? t('image-generation.components.nai.generation.editor.sections.change.source.image')
                      : t('image-generation.components.nai.generation.editor.sections.select.source.image')}
                    modalTitle={t('image-generation.components.nai.generation.editor.sections.select.source.image')}
                    allowSaveDialog={false}
                    onSelect={(image) => handleNaiImageChange('sourceImage', image)}
                  />
                  <Button type="button" variant="secondary" onClick={handleOpenImageEditor} disabled={!naiForm.sourceImage}>
                    {naiForm.action === 'infill'
                      ? t('image-generation.components.nai.generation.editor.sections.edit.source.mask')
                      : t('image-generation.components.nai.generation.editor.sections.edit.source')}
                  </Button>
                  {naiForm.sourceImage ? (
                    <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('sourceImage')}>
                      {t('image-generation.components.nai.common.remove')}
                    </Button>
                  ) : null}
                </div>
                {naiForm.sourceImage ? <NaiSelectedImageCard image={naiForm.sourceImage} alt="NAI source" /> : null}
              </div>
            </FormField>

            {naiForm.action === 'infill' ? (
              <FormField label="Mask Image">
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">{t('image-generation.components.nai.generation.editor.sections.you.can.create.the.mask.in.the')}</div>
                  <div className="flex flex-wrap gap-2">
                    <ImageAttachmentPickerButton
                      label={naiForm.maskImage
                        ? t('image-generation.components.nai.generation.editor.sections.change.mask.image')
                        : t('image-generation.components.nai.generation.editor.sections.select.mask.image')}
                      modalTitle={t('image-generation.components.nai.generation.editor.sections.select.mask.image')}
                      allowSaveDialog={false}
                      onSelect={(image) => handleNaiImageChange('maskImage', image)}
                    />
                    {naiForm.maskImage ? (
                      <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('maskImage')}>
                        {t('image-generation.components.nai.common.remove')}
                      </Button>
                    ) : null}
                  </div>
                  {naiForm.maskImage ? <NaiSelectedImageCard image={naiForm.maskImage} alt="NAI mask" /> : null}
                </div>
              </FormField>
            ) : null}

            <NaiControllerInsetBlock className="space-y-4">
              <div className="text-sm font-medium text-foreground">Image Options</div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Strength">
                  <ScrubbableNumberInput min={0} max={1} step={0.01} value={naiForm.strength} onChange={(value) => handleNaiFieldChange('strength', value)} />
                </FormField>
                <FormField label="Noise">
                  <Input type="number" min={0} max={1} step={0.01} value={naiForm.noise} onChange={(event) => handleNaiFieldChange('noise', event.target.value)} />
                </FormField>
              </div>

              {naiForm.action === 'infill' ? (
                <ToggleRow variant="detail" className="justify-between px-3 py-2.5">
                  <div className="text-sm text-foreground">Original</div>
                  <input type="checkbox" checked={naiForm.addOriginalImage} onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))} />
                </ToggleRow>
              ) : null}
            </NaiControllerInsetBlock>
          </div>
        </NaiControllerSection>
      ) : null}

      <NaiReferencesSection
        supportsCharacterReference={supportsCharacterReference}
        references={naiForm.characterReferences}
        savedReferences={filteredSavedCharacterReferences}
        savedReferenceSearch={savedCharacterReferenceSearch}
        savedReferencesLoading={savedCharacterReferencesLoading}
        onSavedReferenceSearchChange={setSavedCharacterReferenceSearch}
        onAddReference={handleAddCharacterReference}
        onRemoveReference={handleRemoveCharacterReference}
        onReferenceImageChange={handleCharacterReferenceImageChange}
        onReferenceFieldChange={handleCharacterReferenceFieldChange}
        onOpenReferenceSaveModal={handleOpenCharacterReferenceSaveModal}
        onLoadReferenceFromStore={handleLoadCharacterReferenceFromStore}
        onEditReferenceFromStore={handleOpenEditCharacterReferenceFromStore}
        onDeleteReferenceFromStore={(assetId) => void handleDeleteCharacterReferenceFromStore(assetId)}
      />

      <NaiVibesSection
        vibes={naiForm.vibes}
        encodingVibeIndex={encodingVibeIndex}
        naiConnected={naiConnected}
        savedVibes={filteredSavedVibes}
        savedVibeSearch={savedVibeSearch}
        savedVibesLoading={savedVibesLoading}
        onSavedVibeSearchChange={setSavedVibeSearch}
        onAddVibe={handleAddVibe}
        onRemoveVibe={handleRemoveVibe}
        onVibeImageChange={handleVibeImageChange}
        onVibeFieldChange={handleVibeFieldChange}
        onOpenVibeSaveModal={handleOpenVibeSaveModal}
        onLoadVibeFromStore={handleLoadVibeFromStore}
        onEditVibeFromStore={handleOpenEditVibeFromStore}
        onDeleteVibeFromStore={(assetId) => void handleDeleteVibeFromStore(assetId)}
      />

      {showActionSection ? actionSection : null}
    </>
  )
}
