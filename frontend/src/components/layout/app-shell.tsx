import { DatabaseZap, ExternalLink, Home, Image, LogIn, Settings, Upload } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-2xl bg-primary/12 p-2.5 text-primary">
                <Image className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight">CoNAI</h1>
                  <Badge variant="secondary">Frontend reset</Badge>
                  <Badge variant="outline">Phase 1 shell</Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">React 19 + Vite 8 + shadcn + React Compiler</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <a href="http://localhost:1666/health" target="_blank" rel="noreferrer">
                  <DatabaseZap className="h-4 w-4" />
                  Backend health
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <NavLink to="/login">
                  <LogIn className="h-4 w-4" />
                  Login
                </NavLink>
              </Button>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    isActive && 'border-primary/20 bg-primary/10 text-primary',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
