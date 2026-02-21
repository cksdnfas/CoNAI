import { type PropsWithChildren, useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/images', label: 'Images' },
  { to: '/settings', label: 'Settings' },
  { to: '/api-playground', label: 'API Playground' },
]

export function AppShell({ children }: PropsWithChildren) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('frontend-shadcn-test-theme')
    return stored === 'dark'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('frontend-shadcn-test-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="font-semibold tracking-tight">
              ComfyUI Image Manager
            </Link>
            <Badge variant="secondary">shadcn/ui test frontend</Badge>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
              <Sun className="h-4 w-4" />
              <Switch checked={isDark} onCheckedChange={setIsDark} aria-label="toggle dark mode" />
              <Moon className="h-4 w-4" />
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="http://localhost:1666/health" target="_blank" rel="noreferrer">
                Backend health
              </a>
            </Button>
          </div>
        </div>

        <Separator />

        <nav className="mx-auto flex w-full max-w-7xl gap-1 px-4 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-muted text-foreground',
                )
              }
              end={item.to === '/'}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5">{children}</main>
    </div>
  )
}
