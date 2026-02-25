import { type PropsWithChildren, useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Loader2, LogOut, Moon, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-context'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/image-groups', label: 'Image Groups' },
  { to: '/upload', label: 'Upload' },
  { to: '/image-generation', label: 'Image Generation' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const { hasCredentials, isLoading, logout, username } = useAuth()
  const { mode, toggleMode } = useTheme()

  const isDark = mode === 'dark'
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  const handleThemeToggle = (checked: boolean) => {
    if (checked !== isDark) {
      toggleMode()
    }
  }

  const handleLogout = async () => {
    if (isLoggingOut) return

    try {
      setIsLoggingOut(true)
      await logout()
      navigate('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="font-semibold tracking-tight">
              ComfyUI Image Manager
            </Link>
            <Badge variant="secondary">shadcn parity</Badge>
          </div>

          <div className="flex items-center gap-2">
            {hasCredentials && !isLoading && (
              <>
                <div className="hidden items-center gap-2 md:flex">
                  {username ? <Badge variant="outline">{username}</Badge> : null}
                  <Button size="sm" variant="outline" onClick={handleLogout} disabled={isLoggingOut}>
                    {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    Logout
                  </Button>
                </div>
                <Button
                  className="md:hidden"
                  size="icon-sm"
                  variant="outline"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  aria-label="Logout"
                >
                  {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                </Button>
              </>
            )}

            <div className="hidden items-center gap-2 sm:flex">
              <Sun className="h-4 w-4" />
              <Switch checked={isDark} onCheckedChange={handleThemeToggle} aria-label="toggle dark mode" />
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

        <nav className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-4 py-2">
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

      <main className="mx-auto w-full max-w-[1600px] px-4 py-5">{children}</main>
    </div>
  )
}
