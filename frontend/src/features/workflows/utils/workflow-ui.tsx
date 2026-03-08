import React, { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'

type ThemeLike = {
  palette: {
    mode: 'light' | 'dark'
    success: { main: string; contrastText: string }
    error: { main: string; contrastText: string }
    warning: { main: string; contrastText: string }
    info: { main: string; contrastText: string }
    text: { primary: string; secondary: string }
  }
}

type SxLeaf = unknown | ((theme: ThemeLike) => unknown)
type SxObject = Record<string, SxLeaf>
type SxProp = CSSProperties | SxObject | ((theme: ThemeLike) => CSSProperties | SxObject)

type CommonProps = {
  sx?: SxProp
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

function themeSnapshot(): ThemeLike {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return {
    palette: {
      mode: dark ? 'dark' : 'light',
      success: { main: '#16a34a', contrastText: '#fff' },
      error: { main: '#dc2626', contrastText: '#fff' },
      warning: { main: '#d97706', contrastText: '#000' },
      info: { main: '#0284c7', contrastText: '#fff' },
      text: { primary: dark ? '#f5f5f5' : '#111827', secondary: dark ? '#a1a1aa' : '#6b7280' },
    },
  }
}

function resolveStyle(style: CSSProperties | undefined, sx: SxProp | undefined): CSSProperties | undefined {
  if (!sx) return style
  const resolved = typeof sx === 'function' ? sx(themeSnapshot()) : sx
  return { ...(style || {}), ...(resolved as CSSProperties) }
}

export function useTheme() {
  return themeSnapshot()
}

export function alpha(color: string, value: number) {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${value})`
  }
  return color
}

export function Box({ sx, style, ...props }: React.HTMLAttributes<HTMLDivElement> & CommonProps & Record<string, any>) {
  return <div {...props} style={resolveStyle(style, sx)} />
}

export const Stack = Box

export function Paper({ sx, style, ...props }: React.HTMLAttributes<HTMLDivElement> & CommonProps & Record<string, any>) {
  return <div {...props} style={resolveStyle({ border: '1px solid hsl(var(--border))', borderRadius: 8, ...(style || {}) }, sx)} />
}

export const Card = Paper
export const CardContent = Box

export function CardActionArea({ sx, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & CommonProps & Record<string, any>) {
  return <button type="button" {...props} style={resolveStyle(style, sx)} />
}

export function CardMedia({ component = 'img', image, src, sx, style, ...props }: CommonProps & Record<string, unknown> & { component?: string; image?: string; src?: string }) {
  const Comp = component as React.ElementType
  return <Comp {...props} src={src || image} style={resolveStyle(style, sx)} />
}

export function Alert({ sx, style, ...props }: React.HTMLAttributes<HTMLDivElement> & CommonProps & Record<string, any>) {
  return <div role="alert" {...props} style={resolveStyle({ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 10, ...(style || {}) }, sx)} />
}

export function Typography({ component = 'div', sx, style, ...props }: CommonProps & Record<string, unknown> & { component?: string }) {
  const Comp = component as React.ElementType
  return <Comp {...props} style={resolveStyle(style, sx)} />
}

export function Button({ startIcon, endIcon, children, sx, style, ...props }: { startIcon?: ReactNode; endIcon?: ReactNode; onClick?: React.MouseEventHandler<any>;[key: string]: any } & CommonProps) {
  return <button type="button" {...props} style={resolveStyle(style, sx)}>{startIcon}{children}{endIcon}</button>
}

export const IconButton = Button

export function Chip({ label, children, sx, style, ...props }: CommonProps & { label?: ReactNode; onClick?: React.MouseEventHandler<any>;[key: string]: any }) {
  return <span {...props} style={resolveStyle({ display: 'inline-flex', alignItems: 'center', gap: 6, ...(style || {}) }, sx)}>{label ?? children}</span>
}

export function Tooltip({ children }: { children?: ReactNode; title?: ReactNode; placement?: string; arrow?: boolean } & Record<string, any>) {
  return <>{children}</>
}

export function CircularProgress({ size = 18, sx, style, ...props }: CommonProps & Record<string, any> & { size?: number }) {
  return <span {...props} style={resolveStyle({ display: 'inline-block', width: size, height: size, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', ...(style || {}) }, sx)} />
}

export function LinearProgress({ sx, style, ...props }: React.HTMLAttributes<HTMLDivElement> & CommonProps & Record<string, any>) {
  return <div {...props} style={resolveStyle({ height: 4, background: 'hsl(var(--muted))', ...(style || {}) }, sx)} />
}

export function Divider({ sx, style, ...props }: React.HTMLAttributes<HTMLHRElement> & CommonProps & Record<string, any>) {
  return <hr {...props} style={resolveStyle(style, sx)} />
}

export function Collapse({ in: open, children }: { in?: boolean; children?: ReactNode;[key: string]: unknown }) {
  if (!open) return null
  return <>{children}</>
}

export function Snackbar({ open, autoHideDuration, onClose, children, ...props }: { open?: boolean; autoHideDuration?: number; onClose?: () => void; children?: ReactNode;[key: string]: unknown }) {
  useEffect(() => {
    if (!open || !autoHideDuration || !onClose) return
    const t = window.setTimeout(() => onClose(), autoHideDuration)
    return () => window.clearTimeout(t)
  }, [open, autoHideDuration, onClose])
  if (!open) return null
  return <div {...props} style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1400 }}>{children}</div>
}

export function Dialog({ open, onClose, children, ...props }: { open?: boolean; onClose?: () => void; children?: ReactNode;[key: string]: any }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div {...props} style={{ maxWidth: 960, width: '90%', maxHeight: '90vh', overflow: 'auto', background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 10, position: 'relative' }}>
        {children}
        {onClose ? <button type="button" onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'hsl(var(--muted-foreground))' }}>×</button> : null}
      </div>
    </div>
  )
}

export const DialogTitle = Box
export const DialogContent = Box
export const DialogContentText = Typography
export const DialogActions = Box
export const FormControl = Box
export const InputLabel = Typography
export const Toolbar = Box
export const Grid = Box

export function FormControlLabel({ control, label, ...props }: { control?: ReactNode; label?: ReactNode;[key: string]: any }) {
  return <div {...props}>{control}{label}</div>
}

export const Switch = (props: any) => <input type="checkbox" {...props} />
export const Checkbox = (props: any) => <input type="checkbox" {...props} />
export const Radio = (props: any) => <input type="radio" {...props} />
export const RadioGroup = (props: React.HTMLAttributes<HTMLDivElement> & Record<string, any>) => <div {...props}>{props.children}</div>

export type SelectChangeEvent<T = unknown> = { target: { value: T } }

export function Select<T = unknown>({ children, value, onChange, multiple, ...props }: { children?: ReactNode; value?: T; onChange?: (event: SelectChangeEvent<any>) => void; multiple?: boolean;[key: string]: any }) {
  return (
    <select
      {...props}
      value={value as string | number | readonly string[] | undefined}
      multiple={multiple}
      onChange={(event) => onChange?.({ target: { value: multiple ? Array.from(event.target.selectedOptions).map((opt) => opt.value) : event.target.value } })}
    >
      {children}
    </select>
  )
}

export const MenuItem = ({ children, sx, style, ...props }: { children?: ReactNode; sx?: SxProp; style?: CSSProperties;[key: string]: any }) => (
  <div
    {...props}
    style={resolveStyle({
      padding: '6px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer',
      fontSize: '0.875rem',
      ...(style || {})
    }, sx)}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.08)' }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
  >
    {children}
  </div>
)

export function TextField({ label, multiline, rows, minRows, maxRows, select, InputProps, children, value, onChange, ...props }: {
  label?: ReactNode
  multiline?: boolean
  rows?: number
  minRows?: number
  maxRows?: number
  select?: boolean
  InputProps?: { startAdornment?: ReactNode; endAdornment?: ReactNode;[key: string]: unknown }
  children?: ReactNode
  value?: string | number | readonly string[]
  onChange?: React.ChangeEventHandler<any>
  [key: string]: any
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', ...(props.sx as any || {}) }}>
      {label ? <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'hsl(var(--muted-foreground))' }}>{label}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid hsl(var(--border))', borderRadius: 6, padding: '4px 8px', background: 'hsl(var(--background))' }}>
        {InputProps?.startAdornment}
        {select ? (
          <select {...props} value={value} onChange={onChange} style={{ background: 'none', border: 'none', color: 'inherit', width: '100%', outline: 'none' }}>{children}</select>
        ) : multiline ? (
          <textarea {...props} rows={rows || minRows} value={value as string | undefined} onChange={onChange} style={{ background: 'none', border: 'none', color: 'inherit', width: '100%', outline: 'none', resize: 'vertical', minHeight: minRows ? `${minRows * 1.5}em` : undefined }} />
        ) : (
          <input {...props} value={value as string | number | readonly string[] | undefined} onChange={onChange} style={{ background: 'none', border: 'none', color: 'inherit', width: '100%', outline: 'none' }} />
        )}
        {InputProps?.endAdornment}
      </div>
      {props.helperText ? <div style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{props.helperText}</div> : null}
    </div>
  )
}

export const InputAdornment = ({ children, ...props }: { children?: ReactNode;[key: string]: any }) => <span {...props}>{children}</span>
export const List = ({ children, ...props }: React.HTMLAttributes<HTMLUListElement> & Record<string, any>) => <ul {...props}>{children}</ul>
export const ListItem = ({ children, ...props }: React.HTMLAttributes<HTMLLIElement> & Record<string, any>) => <li {...props}>{children}</li>
export const ListItemButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, any>) => <button type="button" {...props}>{children}</button>
export const ListItemIcon = ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & Record<string, any>) => <span {...props}>{children}</span>
export const ListItemText = ({ primary, secondary, children, ...props }: { primary?: ReactNode; secondary?: ReactNode; children?: ReactNode;[key: string]: any }) => <span {...props}>{primary ?? children}{secondary ? <small>{secondary}</small> : null}</span>

export function Popover({ open, children, anchorReference, anchorPosition, onClose }: { open?: boolean; children?: ReactNode; anchorReference?: string; anchorPosition?: { top: number; left: number }; onClose?: () => void;[key: string]: any }) {
  if (!open) return null
  const style: CSSProperties = {
    position: 'fixed',
    zIndex: 1400,
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,.5)',
    minWidth: 160,
    padding: '4px 0'
  }
  if (anchorReference === 'anchorPosition' && anchorPosition) {
    style.top = anchorPosition.top
    style.left = anchorPosition.left
  }
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1399 }} onClick={onClose} />
      <div style={style}>{children}</div>
    </>
  )
}

export function Popper({ open, children, ...props }: { open?: boolean; children?: ReactNode | ((props: any) => ReactNode);[key: string]: any }) {
  if (!open) return null
  return <div style={{ position: 'absolute', zIndex: 1400, background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6 }} {...props}>{typeof children === 'function' ? children({}) : children}</div>
}

export const Menu = Popover
export const ClickAwayListener = ({ children }: { children?: ReactNode;[key: string]: any }) => <>{children}</>
export const Fade = ({ in: open, children }: { in?: boolean; children?: ReactNode;[key: string]: any }) => (open ? <>{children}</> : null)

type TabsContextType = { value: unknown; onChange?: (event: React.SyntheticEvent, value: any) => void }
const TabsContext = React.createContext<TabsContextType | null>(null)

export function Tabs({ value, onChange, children, ...props }: { value?: unknown; onChange?: (event: React.SyntheticEvent, value: any) => void; children?: ReactNode;[key: string]: any }) {
  const context = useMemo(() => ({ value, onChange }), [value, onChange])
  return <TabsContext.Provider value={context}><div {...props}>{children}</div></TabsContext.Provider>
}

export function Tab({ value, label, icon, iconPosition = 'start', ...props }: { value?: unknown; label?: ReactNode; icon?: ReactNode; iconPosition?: 'start' | 'end' | 'top' | 'bottom';[key: string]: any }) {
  const ctx = React.useContext(TabsContext)
  return (
    <button type="button" onClick={(event) => ctx?.onChange?.(event, value)} {...props}>
      {(iconPosition === 'start' || iconPosition === 'top') ? icon : null}
      {label}
      {(iconPosition === 'end' || iconPosition === 'bottom') ? icon : null}
    </button>
  )
}

export const Accordion = ({ children, ...props }: { children?: ReactNode;[key: string]: any }) => <details {...props}>{children}</details>
export const AccordionSummary = ({ children, expandIcon, ...props }: { children?: ReactNode; expandIcon?: ReactNode;[key: string]: any }) => <summary {...props}>{children}{expandIcon}</summary>
export const AccordionDetails = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>

export function Slider({ value, onChange, ...props }: { value?: number | number[]; onChange?: (event: React.ChangeEvent<HTMLInputElement>, value: number) => void;[key: string]: any }) {
  const current = Array.isArray(value) ? value[0] : value
  return <input type="range" value={current ?? 0} onChange={(event) => onChange?.(event, Number(event.target.value))} {...props} />
}
