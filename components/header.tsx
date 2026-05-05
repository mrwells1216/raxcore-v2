'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Target, History, Map, Library, Shield, Ruler } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { UserMenu } from '@/components/user-menu'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'

const publicNavigation = [
  { name: 'Score',   href: '/score',   icon: Target },
  { name: 'Measure', href: '/measure', icon: Ruler },
  { name: 'Map',     href: '/map',     icon: Map },
  { name: 'History', href: '/history', icon: History },
]

const authenticatedNavigation = [
  { name: 'Score',   href: '/score',   icon: Target },
  { name: 'Measure', href: '/measure', icon: Ruler },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Map',     href: '/map',     icon: Map },
]

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: Shield },
]

interface HeaderProps {
  bellSlot?: React.ReactNode
  usageSlot?: React.ReactNode
}

/**
 * RAXCORE brand plate — the logo image is the full brand identity
 * (antler + RAXCORE + Antler Analytics).  No separate text wordmark needed.
 */
function RaxcoreLogo() {
  return (
    <img
      src="/raxcore-logo.jpg"
      alt="RAXcore Antler Analytics"
      height={36}
      style={{
        display: 'block',
        height: 36,
        width: 'auto',
        borderRadius: 4,
      }}
    />
  )
}

export function Header({ bellSlot, usageSlot }: HeaderProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (user) {
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
          .then(({ data }) => setIsAdmin(data?.is_admin || false))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => setIsAdmin(data?.is_admin || false))
      } else {
        setIsAdmin(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const navigation = user ? authenticatedNavigation : publicNavigation
  const fullNavigation = isAdmin ? [...navigation, ...adminNavigation] : navigation

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  return (
    <>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 w-full"
        style={{
          background: 'linear-gradient(180deg, #1c1814 0%, #161412 100%)',
          borderBottom: '1px solid var(--bronze-dark)',
          boxShadow: '0 1px 0 rgba(212,168,75,0.08), 0 2px 12px rgba(0,0,0,0.55)',
        }}
      >
        <div className="container flex h-14 max-w-screen-xl items-center px-4 gap-4">

          {/* Logo — the plate image already contains the full brand identity */}
          <Link href="/" className="flex items-center shrink-0">
            <RaxcoreLogo />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 flex-1 ml-2">
            {fullNavigation.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors rounded"
                  style={active ? {
                    background: 'rgba(160,120,40,0.18)',
                    color: 'var(--bronze-light)',
                    border: '1px solid var(--bronze-dark)',
                  } : {
                    color: 'var(--muted-foreground)',
                    border: '1px solid transparent',
                  }}
                >
                  <item.icon
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: active ? 'var(--bronze-light)' : 'var(--bronze-mid)' }}
                  />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* Desktop right side */}
          <div className="hidden md:flex items-center gap-2 ml-auto">
            {usageSlot}
            {bellSlot}
            <UserMenu initialUser={user} />
          </div>

          {/* Mobile right side */}
          <div className="flex flex-1 items-center justify-end gap-1 md:hidden">
            {bellSlot}
            <UserMenu initialUser={user} />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  style={{ color: 'var(--bronze-mid)' }}
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[280px] p-0"
                style={{
                  background: '#1c1814',
                  border: 'none',
                  borderLeft: '1px solid var(--bronze-dark)',
                }}
              >
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <div className="flex flex-col h-full">
                  <div
                    className="flex items-center justify-between p-4"
                    style={{ borderBottom: '1px solid var(--bronze-dark)' }}
                  >
                    <RaxcoreLogo />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      style={{ color: 'var(--muted-foreground)' }}
                      onClick={() => setOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>

                  <nav className="flex flex-col gap-1 p-4 flex-1">
                    {fullNavigation.map((item) => {
                      const active = isActive(item.href)
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="flex items-center gap-3 px-3 py-3 rounded text-sm font-bold tracking-wider uppercase min-h-[48px] transition-colors"
                          style={active ? {
                            background: 'rgba(160,120,40,0.18)',
                            color: 'var(--bronze-light)',
                            border: '1px solid var(--bronze-dark)',
                          } : {
                            color: 'var(--muted-foreground)',
                            border: '1px solid transparent',
                          }}
                        >
                          <item.icon
                            className="h-5 w-5 shrink-0"
                            style={{ color: active ? 'var(--bronze-light)' : 'var(--bronze-mid)' }}
                          />
                          {item.name}
                        </Link>
                      )
                    })}
                  </nav>

                  {!user && (
                    <div
                      className="p-4"
                      style={{ borderTop: '1px solid var(--bronze-dark)' }}
                    >
                      <div className="flex flex-col gap-2">
                        <Link
                          href="/auth/sign-up"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-center min-h-[48px] rounded text-sm font-bold tracking-widest uppercase btn-bronze"
                        >
                          Get Started
                        </Link>
                        <Link
                          href="/auth/login"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-center min-h-[48px] rounded text-xs font-bold tracking-widest uppercase"
                          style={{
                            border: '1px solid var(--bronze-dark)',
                            color: 'var(--bronze-light)',
                            background: 'rgba(160,120,40,0.08)',
                          }}
                        >
                          Sign In
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 flex md:hidden"
        style={{
          background: 'linear-gradient(0deg, #1c1814 0%, #161412 100%)',
          borderTop: '1px solid var(--bronze-dark)',
          boxShadow: '0 -1px 0 rgba(212,168,75,0.08), 0 -4px 20px rgba(0,0,0,0.60)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        aria-label="Bottom navigation"
      >
        {fullNavigation.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] touch-manipulation transition-colors"
              style={{ color: active ? 'var(--bronze-light)' : 'var(--muted-foreground)' }}
              aria-current={active ? 'page' : undefined}
            >
              {/* Active indicator line */}
              <div
                className="h-0.5 w-8 rounded-full mb-0.5 transition-all duration-200"
                style={{ background: active ? 'var(--bronze-light)' : 'transparent' }}
              />
              <item.icon
                className="h-5 w-5"
                style={{ color: active ? 'var(--bronze-light)' : 'var(--bronze-mid)' }}
              />
              <span className="text-[9px] font-bold tracking-widest uppercase">{item.name}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
