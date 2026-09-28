/**
 * Dev-only catalog of the shared UI kit (components/ui + segmented controls).
 * Registered in router.tsx behind `import.meta.env.DEV`, so it never reaches production bundles.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Copy, ImageOff, Inbox, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { CountSummary } from '@/components/ui/count-summary'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Inset } from '@/components/ui/inset'
import { LoadingState, Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { StatTile } from '@/components/ui/stat-tile'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Tip } from '@/components/ui/tooltip'
import { DEFAULT_APPEARANCE_SETTINGS, applyAppearanceTheme } from '@/lib/appearance'
import { COUNT_UNITS } from '@/lib/count-display'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'

type ThemeChoice = 'app' | 'light' | 'dark'

const BUTTON_VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const
const BUTTON_SIZES = ['xs', 'sm', 'default', 'lg'] as const
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const
const BADGE_VARIANTS = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const
const INPUT_VARIANTS = ['default', 'settings', 'detail', 'detailNested'] as const
const SECTION_VARIANTS = ['page', 'settings', 'drawer', 'controller'] as const
const PROGRESS_TONES = ['default', 'success', 'warning', 'destructive', 'info'] as const
const TEXT_VARIANTS = ['overline', 'label', 'body', 'muted', 'caption', 'title'] as const

// Full class strings so Tailwind's scanner generates every utility.
const TYPE_SCALE = [
  ['text-2xs', 'text-2xs'],
  ['text-xs', 'text-xs'],
  ['text-sm', 'text-sm'],
  ['text-base', 'text-base'],
  ['text-lg', 'text-lg'],
  ['text-xl', 'text-xl'],
  ['text-2xl', 'text-2xl'],
] as const

const STATUS_SWATCHES = [
  { name: 'destructive', solid: 'bg-destructive text-destructive-foreground', soft: 'bg-destructive-soft text-destructive-soft-foreground' },
  { name: 'success', solid: 'bg-success text-success-foreground', soft: 'bg-success-soft text-success-soft-foreground' },
  { name: 'warning', solid: 'bg-warning text-warning-foreground', soft: 'bg-warning-soft text-warning-soft-foreground' },
  { name: 'info', solid: 'bg-info text-info-foreground', soft: 'bg-info-soft text-info-soft-foreground' },
] as const

const SURFACE_SWATCHES = [
  ['background', 'bg-background text-foreground'],
  ['surface-lowest', 'bg-surface-lowest text-foreground'],
  ['surface-low', 'bg-surface-low text-foreground'],
  ['surface-container', 'bg-surface-container text-foreground'],
  ['surface-high', 'bg-surface-high text-foreground'],
  ['surface-highest', 'bg-surface-highest text-foreground'],
  ['surface-bright', 'bg-surface-bright text-foreground'],
  ['card', 'bg-card text-card-foreground'],
  ['muted', 'bg-muted text-muted-foreground'],
  ['accent', 'bg-accent text-accent-foreground'],
  ['primary', 'bg-primary text-primary-foreground'],
  ['secondary', 'bg-secondary text-secondary-foreground'],
  ['backdrop', 'bg-backdrop text-white'],
] as const

const ELEVATIONS = ['shadow-elevation-1', 'shadow-elevation-2', 'shadow-elevation-3'] as const

// Offsets make each layer visibly overlap the one below; the z class decides who is on top.
const Z_LAYERS = [
  { name: 'base (0)', className: 'z-base left-0 top-0 bg-surface-high' },
  { name: 'raised (10)', className: 'z-raised left-6 top-5 bg-surface-highest' },
  { name: 'sticky (40)', className: 'z-sticky left-12 top-10 bg-info-soft text-info-soft-foreground' },
  { name: 'header (50)', className: 'z-header left-18 top-15 bg-success-soft text-success-soft-foreground' },
  { name: 'drawer (84)', className: 'z-drawer left-24 top-20 bg-warning-soft text-warning-soft-foreground' },
  { name: 'popover (140)', className: 'z-popover left-30 top-25 bg-surface-bright' },
  { name: 'modal (6000)', className: 'z-modal left-36 top-30 bg-primary text-primary-foreground' },
  { name: 'floating (6500)', className: 'z-floating left-42 top-35 bg-secondary text-secondary-foreground' },
  { name: 'toast (7000)', className: 'z-toast left-48 top-40 bg-destructive-soft text-destructive-soft-foreground' },
] as const

function CatalogSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4 border-t border-border/70 pt-6">
      <Heading level={2}>{title}</Heading>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Text variant="overline" className="font-semibold">{label}</Text>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Apply a forced light/dark mode on top of the saved appearance, restoring the saved one on leave. */
function useCatalogTheme(choice: ThemeChoice) {
  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  useEffect(() => {
    const saved = appearanceQuery.data ?? DEFAULT_APPEARANCE_SETTINGS
    applyAppearanceTheme(choice === 'app' ? saved : { ...saved, themeMode: choice })
    return () => applyAppearanceTheme(saved)
  }, [appearanceQuery.data, choice])
}

export function UiCatalogPage() {
  const confirm = useConfirm()
  const [theme, setTheme] = useState<ThemeChoice>('app')
  const [modalOpen, setModalOpen] = useState(false)
  const [wideModalOpen, setWideModalOpen] = useState(false)
  const [confirmResult, setConfirmResult] = useState<string>('—')
  const [checked, setChecked] = useState<boolean | 'indeterminate'>('indeterminate')
  const [switchOn, setSwitchOn] = useState(true)
  const [slider, setSlider] = useState([40])
  const [range, setRange] = useState([20, 70])
  const [segment, setSegment] = useState('grid')
  const [tabBar, setTabBar] = useState('general')
  const [menuChecked, setMenuChecked] = useState(true)
  const [menuRadio, setMenuRadio] = useState('name')
  const [retrying, setRetrying] = useState(false)

  useCatalogTheme(theme)

  const askConfirm = async (tone: 'default' | 'destructive') => {
    const ok = await confirm(tone === 'destructive'
      ? { title: '이미지 3장을 삭제할까?', description: '삭제하면 되돌릴 수 없어.', confirmLabel: '삭제', tone }
      : { title: '설정을 저장할까?', description: '저장하면 바로 적용돼.' })
    setConfirmResult(`${tone}: ${ok ? 'confirmed' : 'cancelled'}`)
  }

  const nav = [
    'buttons', 'badges', 'inputs', 'selection', 'progress', 'overlays', 'navigation', 'surfaces', 'sections', 'states', 'counts', 'typography', 'colours', 'z-layers',
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-header border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <Heading level={1} className="text-xl">UI catalog</Heading>
            <Text variant="caption">Dev-only. Shared components from components/ui and components/common.</Text>
          </div>
          <SegmentedControl
            ariaLabel="Theme"
            size="sm"
            value={theme}
            onChange={(value) => setTheme(value as ThemeChoice)}
            items={[
              { value: 'app', label: 'App setting' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <nav aria-label="Catalog sections" className="mx-auto flex max-w-6xl flex-wrap gap-x-3 gap-y-1 px-4 pb-2">
          {nav.map((id) => (
            <a key={id} href="#/dev/ui" onClick={(event) => { event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }} className="text-xs text-muted-foreground hover:text-foreground">
              {id}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-6">
        <CatalogSection id="buttons" title="Button / IconButton">
          {BUTTON_VARIANTS.map((variant) => (
            <Row key={variant} label={`variant=${variant}`}>
              {BUTTON_SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>{size}</Button>
              ))}
              <Button variant={variant}><Plus />With icon</Button>
              <Button variant={variant} disabled>Disabled</Button>
            </Row>
          ))}
          <Row label="IconButton sizes (tooltip = label)">
            {ICON_SIZES.map((size) => (
              <IconButton key={size} size={size} variant="outline" label={`Edit (${size})`}><Pencil /></IconButton>
            ))}
            <IconButton variant="ghost" label="Settings"><Settings /></IconButton>
            <IconButton variant="destructive" label="Delete"><Trash2 /></IconButton>
            <IconButton variant="secondary" label="No tooltip" tooltip={false}><Copy /></IconButton>
          </Row>
        </CatalogSection>

        <CatalogSection id="badges" title="Badge">
          <Row label="variants">
            {BADGE_VARIANTS.map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}
          </Row>
        </CatalogSection>

        <CatalogSection id="inputs" title="Input / Select / Textarea / Field / ToggleRow">
          <div className="grid gap-4 md:grid-cols-2">
            {INPUT_VARIANTS.map((variant) => (
              <Field key={variant} label={`Input variant=${variant}`} hint="hint">
                <Input variant={variant} placeholder="Placeholder" />
              </Field>
            ))}
            <Field label="Input disabled"><Input disabled value="Disabled" readOnly /></Field>
            <Field label="Input invalid"><Input aria-invalid defaultValue="Invalid value" /></Field>
            {INPUT_VARIANTS.map((variant) => (
              <Field key={`select-${variant}`} label={`Select variant=${variant}`}>
                <Select variant={variant} defaultValue="b">
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </Select>
              </Field>
            ))}
            <Field label="Textarea default"><Textarea rows={3} placeholder="Multi-line" /></Field>
            <Field label="Textarea settings"><Textarea variant="settings" rows={3} defaultValue="Settings variant" /></Field>
            <ToggleRow variant="settings"><Checkbox defaultChecked />ToggleRow settings + Checkbox</ToggleRow>
            <ToggleRow variant="detail"><Switch defaultChecked />ToggleRow detail + Switch</ToggleRow>
          </div>
        </CatalogSection>

        <CatalogSection id="selection" title="Checkbox / Switch / Slider">
          <Row label="Checkbox">
            <label className="flex items-center gap-2 text-sm"><Checkbox />Unchecked</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked />Checked</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked="indeterminate" />Indeterminate</label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={setChecked} />Interactive ({String(checked)})
            </label>
            <label className="flex items-center gap-2 text-sm"><Checkbox disabled />Disabled</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox disabled defaultChecked />Disabled checked</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox aria-invalid />Invalid</label>
          </Row>
          <Row label="Switch">
            <label className="flex items-center gap-2 text-sm"><Switch checked={switchOn} onCheckedChange={setSwitchOn} />Default ({switchOn ? 'on' : 'off'})</label>
            <label className="flex items-center gap-2 text-sm"><Switch size="sm" defaultChecked />Small</label>
            <label className="flex items-center gap-2 text-sm"><Switch disabled />Disabled</label>
            <label className="flex items-center gap-2 text-sm"><Switch disabled defaultChecked />Disabled on</label>
            <label className="flex items-center gap-2 text-sm"><Switch aria-invalid />Invalid</label>
          </Row>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Text variant="overline" className="font-semibold">Slider ({slider[0]})</Text>
              <Slider value={slider} onValueChange={setSlider} aria-label="Single value" />
            </div>
            <div className="space-y-2">
              <Text variant="overline" className="font-semibold">Range ({range.join('–')})</Text>
              <Slider value={range} onValueChange={setRange} thumbLabels={['Minimum', 'Maximum']} />
            </div>
            <div className="space-y-2">
              <Text variant="overline" className="font-semibold">Disabled</Text>
              <Slider defaultValue={[60]} disabled aria-label="Disabled" />
            </div>
          </div>
        </CatalogSection>

        <CatalogSection id="progress" title="Progress / Spinner">
          <div className="grid gap-4 md:grid-cols-2">
            {PROGRESS_TONES.map((tone, index) => (
              <div key={tone} className="space-y-1">
                <Text variant="caption">tone={tone} value={20 + index * 18}</Text>
                <Progress tone={tone} value={20 + index * 18} aria-label={tone} />
              </div>
            ))}
            {(['sm', 'default', 'lg'] as const).map((size) => (
              <div key={size} className="space-y-1">
                <Text variant="caption">size={size}</Text>
                <Progress size={size} value={55} aria-label={size} />
              </div>
            ))}
            <div className="space-y-1">
              <Text variant="caption">indeterminate (value=null)</Text>
              <Progress value={null} aria-label="Indeterminate" />
            </div>
            <div className="space-y-1">
              <Text variant="caption">indeterminate forced, tone=info</Text>
              <Progress indeterminate value={30} tone="info" aria-label="Indeterminate info" />
            </div>
          </div>
          <Row label="Spinner sizes">
            <Spinner size="sm" /><Spinner size="md" /><Spinner size="lg" label="Loading" />
          </Row>
        </CatalogSection>

        <CatalogSection id="overlays" title="Modal / Confirm / Tooltip / Dropdown / Popover">
          <Row label="Modal + ConfirmDialog (useConfirm)">
            <Button variant="outline" onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="outline" onClick={() => setWideModalOpen(true)}>Open wide modal + header</Button>
            <Button onClick={() => void askConfirm('default')}>Confirm (default)</Button>
            <Button variant="destructive" onClick={() => void askConfirm('destructive')}>Confirm (destructive)</Button>
            <Text variant="caption">Last result: {confirmResult}</Text>
          </Row>
          <Row label="Tooltip sides">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Tip key={side} content={`Tooltip on ${side}`} side={side}>
                <Button variant="secondary" size="sm">{side}</Button>
              </Tip>
            ))}
          </Row>
          <Row label="DropdownMenu / Popover">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><MoreHorizontal />Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem><Pencil />Rename<DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem><Copy />Duplicate</DropdownMenuItem>
                <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={menuChecked} onCheckedChange={setMenuChecked}>Show hidden</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel inset>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={menuRadio} onValueChange={setMenuRadio}>
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>Sub item A</DropdownMenuItem>
                    <DropdownMenuItem>Sub item B</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive"><Trash2 />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent className="space-y-3">
                <Text variant="title">Popover title</Text>
                <Text variant="muted">Floating panel on surface-high, above modals.</Text>
                <Input placeholder="Inline field" />
                <div className="flex justify-end">
                  <PopoverClose asChild><Button size="sm">Done</Button></PopoverClose>
                </div>
              </PopoverContent>
            </Popover>
          </Row>
        </CatalogSection>

        <CatalogSection id="navigation" title="Tabs / SegmentedControl / SegmentedTabBar">
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">First</TabsTrigger>
              <TabsTrigger value="two">Second</TabsTrigger>
              <TabsTrigger value="three" disabled>Disabled</TabsTrigger>
            </TabsList>
            <TabsContent value="one"><Inset>First panel</Inset></TabsContent>
            <TabsContent value="two"><Inset>Second panel</Inset></TabsContent>
          </Tabs>
          {(['xs', 'sm', 'md'] as const).map((size) => (
            <Row key={size} label={`SegmentedControl size=${size}`}>
              <SegmentedControl
                ariaLabel={`Layout ${size}`}
                size={size}
                value={segment}
                onChange={setSegment}
                items={[
                  { value: 'grid', label: 'Grid' },
                  { value: 'list', label: 'List' },
                  { value: 'masonry', label: 'Masonry' },
                  { value: 'off', label: 'Disabled', disabled: true },
                ]}
              />
            </Row>
          ))}
          <SegmentedTabBar
            ariaLabel="Settings tabs"
            value={tabBar}
            onChange={setTabBar}
            items={[
              { value: 'general', label: 'General' },
              { value: 'appearance', label: 'Appearance' },
              { value: 'advanced', label: 'Advanced' },
            ]}
            actions={<Button size="sm" variant="outline">Action</Button>}
          />
        </CatalogSection>

        <CatalogSection id="surfaces" title="Card / Alert / Inset / StatTile / Skeleton">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Card description text.</CardDescription>
              </CardHeader>
              <CardContent><Text>Card content.</Text></CardContent>
            </Card>
            <div className="space-y-3">
              <Alert><Inbox /><AlertTitle>Default alert</AlertTitle><AlertDescription>Neutral information.</AlertDescription></Alert>
              <Alert variant="destructive"><Trash2 /><AlertTitle>Destructive alert</AlertTitle><AlertDescription>Something failed.</AlertDescription></Alert>
            </div>
            <Inset><Text variant="muted">Inset surface for dense notes and previews.</Text></Inset>
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Images" value="12,345" />
              <StatTile label="Groups" value="87" />
              <StatTile label="Size" value="4.2 GB" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
          <Row label="Elevation">
            {ELEVATIONS.map((shadow) => (
              <div key={shadow} className={`rounded-sm bg-surface-container px-4 py-6 text-xs ${shadow}`}>{shadow}</div>
            ))}
          </Row>
        </CatalogSection>

        <CatalogSection id="sections" title="Section variants">
          <div className="grid gap-4 md:grid-cols-2">
            {SECTION_VARIANTS.map((variant) => (
              <Section
                key={variant}
                variant={variant}
                heading={`variant=${variant}`}
                description="Section description"
                actions={<Button size="sm" variant="outline">Action</Button>}
              >
                <Text variant="muted">Body content.</Text>
              </Section>
            ))}
            <Section heading="Collapsible (defaultOpen=false)" collapsible defaultOpen={false}>
              <Text variant="muted">Hidden until expanded.</Text>
            </Section>
            <Section variant="settings" heading="Collapsible settings" collapsible>
              <Text variant="muted">Expanded by default.</Text>
            </Section>
          </div>
        </CatalogSection>

        <CatalogSection id="states" title="EmptyState / LoadingState / ErrorState">
          <div className="grid gap-4 md:grid-cols-2">
            <EmptyState icon={ImageOff} title="이미지가 아직 없어" description="폴더를 추가하면 여기에 보여." action={<Button size="sm"><Plus />폴더 추가</Button>} />
            <EmptyState icon={Inbox} title="Default without action" />
            <EmptyState size="compact" icon={Inbox} title="Compact empty state" description="With a caption" action={<Button size="xs" variant="outline">Action</Button>} />
            <EmptyState size="compact" title="Compact, no icon" />
            <LoadingState />
            <div className="space-y-3">
              <LoadingState variant="inline" />
              <LoadingState variant="inline" label="Custom label…" />
              <LoadingState variant="inline" label={null} />
            </div>
            <ErrorState description="서버에 연결하지 못했어." error={new Error('ECONNREFUSED 127.0.0.1:1666')} onRetry={() => { setRetrying(true); window.setTimeout(() => setRetrying(false), 1500) }} isRetrying={retrying} />
            <div className="space-y-3">
              <ErrorState size="compact" title="Compact error" onRetry={() => undefined} />
              <ErrorState size="compact" title="Compact, no retry" description="Description only" />
            </div>
          </div>
        </CatalogSection>

        <CatalogSection id="counts" title="CountSummary">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>known: <CountSummary status="known" total={12345} /></div>
            <div>known + unit: <CountSummary status="known" total={12345} unit={COUNT_UNITS.images} /></div>
            <div>known + hidden: <CountSummary status="known" total={120} hidden={7} unit={COUNT_UNITS.items} /></div>
            <div>position: <CountSummary status="known" total={12345} position={12} /></div>
            <div>zero: <CountSummary status="known" total={0} unit={COUNT_UNITS.images} /></div>
            <div>pending: <CountSummary status="pending" total={null} /></div>
            <div>error: <CountSummary status="error" total={null} /></div>
          </div>
        </CatalogSection>

        <CatalogSection id="typography" title="Text / Heading / type scale">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              {TEXT_VARIANTS.map((variant) => (
                <Text key={variant} variant={variant}>Text variant={variant}</Text>
              ))}
            </div>
            <div className="space-y-2">
              <Heading level={1}>Heading level 1</Heading>
              <Heading level={2}>Heading level 2</Heading>
              <Heading level={3}>Heading level 3</Heading>
            </div>
            <div className="space-y-1 md:col-span-2">
              {TYPE_SCALE.map(([name, className]) => (
                <div key={name} className={className}>{name} — 이미지 3장을 저장했어 / Saved 3 images</div>
              ))}
              <div className="text-xs uppercase tracking-overline text-muted-foreground">tracking-overline</div>
            </div>
          </div>
        </CatalogSection>

        <CatalogSection id="colours" title="Colour tokens">
          <Row label="Status (solid / soft)">
            {STATUS_SWATCHES.map((swatch) => (
              <div key={swatch.name} className="overflow-hidden rounded-sm border border-border/70 text-xs">
                <div className={`px-4 py-3 font-medium ${swatch.solid}`}>{swatch.name}</div>
                <div className={`px-4 py-3 ${swatch.soft}`}>{swatch.name}-soft</div>
              </div>
            ))}
          </Row>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {SURFACE_SWATCHES.map(([name, className]) => (
              <div key={name} className={`rounded-sm border border-border/70 px-3 py-4 text-xs ${className}`}>{name}</div>
            ))}
          </div>
        </CatalogSection>

        <CatalogSection id="z-layers" title="z-index layers">
          <Text variant="muted">Each tile uses its z-* token; later tiles should sit on top. Isolated so it does not cover the page.</Text>
          <div className="relative isolate h-64 overflow-hidden rounded-sm bg-surface-low">
            {[...Z_LAYERS].reverse().map((layer) => (
              <div key={layer.name} className={`absolute w-44 rounded-sm px-3 py-2 text-xs font-medium shadow-elevation-1 ${layer.className}`}>
                z-{layer.name}
              </div>
            ))}
          </div>
        </CatalogSection>
      </main>

      <Modal open={modalOpen} title="Modal title" description="Radix dialog with Esc / backdrop / back close." onClose={() => setModalOpen(false)} widthClassName="max-w-lg">
        <ModalBody>
          <Field label="Name"><Input autoFocus placeholder="Type here" /></Field>
          <ToggleRow variant="detail"><Checkbox defaultChecked />Remember choice</ToggleRow>
          <Tip content="Tooltips render above modals"><Button variant="secondary" size="sm">Hover me</Button></Tip>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>취소</Button>
            <Button onClick={() => void askConfirm('default')}>Nested confirm</Button>
          </ModalFooter>
        </ModalBody>
      </Modal>

      <Modal
        open={wideModalOpen}
        title="Wide modal"
        headerContent={<SegmentedControl ariaLabel="Modal tabs" size="sm" value={segment} onChange={setSegment} items={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />}
        onClose={() => setWideModalOpen(false)}
      >
        <ModalBody>
          <Text>Default max-w-4xl width, with header content.</Text>
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" size="sm">Popover inside modal</Button></PopoverTrigger>
            <PopoverContent>Popover above the modal.</PopoverContent>
          </Popover>
        </ModalBody>
      </Modal>
    </div>
  )
}
