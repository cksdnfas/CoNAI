import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronDown, Dices, Plus, Trash2 } from 'lucide-react'
import type { StoredNaiCharacterReferenceAsset, StoredNaiVibeAsset } from '@/lib/api-image-generation-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  FormField,
  NAI_ACTION_OPTIONS,
  NAI_MODEL_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  supportsNaiTransparentBackground,
  type NAIFormDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiCharacterPositionBoard } from './nai-character-position-board'
import { Section } from '@/components/ui/section'
import { NaiControllerInsetBlock, NaiPromptSection } from './nai-generation-panel-sections'
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
  maxSampleCount = NAI_SAMPLE_COUNT_MAX,
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
  /** Upper bound for the samples input (resolution/balance limit from the cost estimate). */
  maxSampleCount?: number
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
  const hasCharacters = naiForm.characters.length > 0

  return (
    <>
      <NaiPromptSection
        prompt={naiForm.prompt}
        negativePrompt={naiForm.negativePrompt}
        onPromptChange={(value) => handleNaiFieldChange('prompt', value)}
        onNegativePromptChange={(value) => handleNaiFieldChange('negativePrompt', value)}
      />

      <Section
        // Remount when the list goes empty <-> non-empty so it opens once characters exist (e.g. reused from history).
        key={hasCharacters ? 'nai-characters-present' : 'nai-characters-empty'}
        variant="controller"
        heading={t({ ko: '캐릭터 프롬프트', en: 'Character Prompt' })}
        collapsible
        defaultOpen={hasCharacters}
        actions={(
          <>
            <Badge variant="outline">{naiForm.characters.length}</Badge>
            <IconButton
              size="icon-sm"
              variant="secondary"
              onClick={handleAddCharacterPrompt}
              disabled={!supportsCharacterPrompts}
              label={t('image-generation.components.nai.generation.editor.sections.add.character')}
            >
              <Plus className="h-4 w-4" />
            </IconButton>
          </>
        )}
      >
        {!supportsCharacterPrompts ? (
          <div className="text-xs text-[#ffb4ab]">{t('image-generation.components.nai.generation.editor.sections.character.prompt.is.not.available.for.the')}</div>
        ) : (
          <>
            <ToggleRow variant="detail" className="justify-between px-3 py-2.5">
              <div className="text-sm font-medium text-foreground">AI's Choice</div>
              <Switch
                checked={naiForm.characterPositionAiChoice}
                disabled={!canUseCharacterPositions}
                onCheckedChange={(checked) => setNaiForm((current) => ({
                  ...current,
                  characterPositionAiChoice: checked,
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

            {hasCharacters ? <div className="overflow-hidden rounded-sm border border-border/85 divide-y divide-border/85 bg-surface-low/40">
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
            </div> : null}
          </>
        )}
      </Section>

      <NaiSettingsSection
        naiForm={naiForm}
        setNaiForm={setNaiForm}
        maxSampleCount={maxSampleCount}
        handleNaiFieldChange={handleNaiFieldChange}
        handleResolutionPresetChange={handleResolutionPresetChange}
      />

      {naiForm.action !== 'generate' ? (
        <Section variant="controller" heading={t({ ko: '이미지', en: 'Images' })} collapsible defaultOpen={false}>
          <div className="space-y-4">
            <FormField label={t({ ko: '원본 이미지', en: 'Source Image' })}>
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
              <FormField label={t({ ko: '마스크 이미지', en: 'Mask Image' })}>
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
              <div className="text-sm font-medium text-foreground">{t({ ko: '이미지 옵션', en: 'Image Options' })}</div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={t({ ko: '강도', en: 'Strength' })}>
                  <NumberStepperInput min={0} max={1} step={0.01} value={naiForm.strength} onValueCommit={(value) => handleNaiFieldChange('strength', value)} />
                </FormField>
                <FormField label={t({ ko: '노이즈', en: 'Noise' })}>
                  <NumberStepperInput min={0} max={1} step={0.01} value={naiForm.noise} onValueCommit={(nextValue) => handleNaiFieldChange('noise', nextValue)} />
                </FormField>
              </div>

              {naiForm.action === 'infill' ? (
                <ToggleRow variant="detail" className="justify-between px-3 py-2.5">
                  <div className="text-sm text-foreground">{t({ ko: '원본', en: 'Original' })}</div>
                  <Switch checked={naiForm.addOriginalImage} onCheckedChange={(checked) => setNaiForm((current) => ({ ...current, addOriginalImage: checked }))} />
                </ToggleRow>
              ) : null}
            </NaiControllerInsetBlock>
          </div>
        </Section>
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

type NaiFieldName = Parameters<Parameters<typeof NaiGenerationEditorSections>[0]['handleNaiFieldChange']>[0]

const NAI_ADVANCED_OPEN_STORAGE_KEY = 'conai.nai-settings.advanced-open'
/** NovelAI accepts seeds up to 2^32 - 8; the backend rolls in the same range when the seed is blank. */
const NAI_SEED_MAX = 4294967288

function readAdvancedOpen() {
  try {
    return window.localStorage.getItem(NAI_ADVANCED_OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeAdvancedOpen(isOpen: boolean) {
  try {
    window.localStorage.setItem(NAI_ADVANCED_OPEN_STORAGE_KEY, isOpen ? '1' : '0')
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the toggle still works for this session.
  }
}

function rollNaiSeed() {
  return String(Math.floor(Math.random() * NAI_SEED_MAX))
}

/** Render one on/off setting as a label + Switch row that lines up with the grid's form fields. */
function NaiSwitchField({ label, checked, onCheckedChange }: { label: string, checked: boolean, onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 self-end rounded-sm bg-surface-low px-3 py-2 text-sm font-medium text-foreground sm:min-h-9">
      <span className="min-w-0 truncate">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

/** Render the seed input with a "random each time" switch (blank seed) and a dice button that rolls a fixed seed. */
function NaiSeedField({ seed, onSeedChange }: { seed: string, onSeedChange: (value: string) => void }) {
  const { t } = useI18n()
  const labelId = useId()
  const isRandom = seed.trim().length === 0
  // Remember the last fixed seed so switching "random" off restores it instead of rolling a new one.
  const [lastFixedSeed, setLastFixedSeed] = useState<string | null>(isRandom ? null : seed)
  if (!isRandom && seed !== lastFixedSeed) {
    setLastFixedSeed(seed)
  }

  const seedLabel = t({ ko: '시드', en: 'Seed' })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-sm font-medium text-foreground">{seedLabel}</span>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          {t({ ko: '매번 랜덤', en: 'Random each time' })}
          <Switch
            size="sm"
            checked={isRandom}
            onCheckedChange={(checked) => onSeedChange(checked ? '' : (lastFixedSeed ?? rollNaiSeed()))}
          />
        </label>
      </div>
      <div className="flex items-stretch gap-2">
        <NumberStepperInput
          aria-labelledby={labelId}
          aria-label={seedLabel}
          min={0}
          max={NAI_SEED_MAX}
          allowEmpty
          disabled={isRandom}
          placeholder={t({ ko: '랜덤', en: 'Random' })}
          value={seed}
          onValueCommit={onSeedChange}
        />
        <IconButton
          variant="secondary"
          className="h-auto min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
          label={t({ ko: '새 시드 굴리기', en: 'Roll a new seed' })}
          onClick={() => onSeedChange(rollNaiSeed())}
        >
          <Dices className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}

/** Render the NAI settings: model/size/steps/seed stay visible, sampler/scheduler/CFG/Variety+ sit in a remembered "Advanced" group. */
function NaiSettingsSection({
  naiForm,
  setNaiForm,
  maxSampleCount,
  handleNaiFieldChange,
  handleResolutionPresetChange,
}: {
  naiForm: NAIFormDraft
  setNaiForm: Dispatch<SetStateAction<NAIFormDraft>>
  maxSampleCount: number
  handleNaiFieldChange: (field: NaiFieldName, value: string) => void
  handleResolutionPresetChange: (presetKey: string) => void
}) {
  const { t } = useI18n()
  const advancedRegionId = useId()
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(readAdvancedOpen)
  const toggleAdvancedOpen = () => {
    const nextOpen = !isAdvancedOpen
    writeAdvancedOpen(nextOpen)
    setIsAdvancedOpen(nextOpen)
  }

  const samplerLabel = NAI_SAMPLER_OPTIONS.find((option) => option.value === naiForm.sampler)?.label ?? naiForm.sampler
  const schedulerLabel = NAI_SCHEDULER_OPTIONS.find((option) => option.value === naiForm.scheduler)?.label ?? naiForm.scheduler
  const advancedSummary = [samplerLabel, schedulerLabel, `CFG ${naiForm.scale}`, naiForm.varietyPlus ? 'Variety+' : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Section variant="controller" heading={t({ ko: '설정', en: 'Settings' })}>
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-3">
            <FormField label={t({ ko: '모델', en: 'Model' })}>
              <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                {NAI_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField label={t({ ko: '생성 방식', en: 'Action' })}>
            <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
              {NAI_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label={t({ ko: '해상도 프리셋', en: 'Preset' })}>
            <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
              {NAI_RESOLUTION_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.label}</option>
              ))}
              <option value="custom">{t({ ko: '사용자 지정', en: 'Custom' })}</option>
            </Select>
          </FormField>

          <FormField label={t({ ko: '너비', en: 'Width' })}>
            <NumberStepperInput min={64} step={64} value={naiForm.width} onValueCommit={(nextValue) => handleNaiFieldChange('width', nextValue)} />
          </FormField>

          <FormField label={t({ ko: '높이', en: 'Height' })}>
            <NumberStepperInput min={64} step={64} value={naiForm.height} onValueCommit={(nextValue) => handleNaiFieldChange('height', nextValue)} />
          </FormField>

          <FormField label={t({ ko: '스텝', en: 'Steps' })}>
            <NumberStepperInput min={1} max={100} value={naiForm.steps} onValueCommit={(nextValue) => handleNaiFieldChange('steps', nextValue)} />
          </FormField>

          <FormField label={t({ ko: '요청당 이미지', en: 'Images per request' })}>
            <NumberStepperInput min={NAI_SAMPLE_COUNT_MIN} max={maxSampleCount} step={1} value={naiForm.samples} onValueCommit={(nextValue) => handleNaiFieldChange('samples', nextValue)} />
          </FormField>

          <NaiSeedField seed={naiForm.seed} onSeedChange={(nextValue) => handleNaiFieldChange('seed', nextValue)} />

          {supportsNaiTransparentBackground(naiForm.model) ? (
            <NaiSwitchField
              label={t({ ko: '투명 배경', en: 'Transparent background' })}
              checked={naiForm.transparentBackground}
              onCheckedChange={(checked) => setNaiForm((current) => ({ ...current, transparentBackground: checked }))}
            />
          ) : null}
        </div>

        <div className="border-t border-border/70 pt-3">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            aria-expanded={isAdvancedOpen}
            aria-controls={advancedRegionId}
            onClick={toggleAdvancedOpen}
          >
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', !isAdvancedOpen && '-rotate-90')} aria-hidden />
            <span className="shrink-0">{t({ ko: '고급', en: 'Advanced' })}</span>
            {!isAdvancedOpen ? (
              <span className="min-w-0 truncate text-[11px] font-normal normal-case tracking-normal">{advancedSummary}</span>
            ) : null}
          </button>

          {isAdvancedOpen ? (
            <div id={advancedRegionId} className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FormField label={t({ ko: '샘플러', en: 'Sampler' })}>
                <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                  {NAI_SAMPLER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label={t({ ko: '스케줄러', en: 'Scheduler' })}>
                <Select value={naiForm.scheduler} onChange={(event) => handleNaiFieldChange('scheduler', event.target.value)}>
                  {NAI_SCHEDULER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label="CFG Scale">
                <NumberStepperInput min={1} max={20} step={0.1} value={naiForm.scale} onValueCommit={(nextValue) => handleNaiFieldChange('scale', nextValue)} />
              </FormField>

              <NaiSwitchField
                label="Variety+"
                checked={naiForm.varietyPlus}
                onCheckedChange={(checked) => setNaiForm((current) => ({ ...current, varietyPlus: checked }))}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
