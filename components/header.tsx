'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Menu, X, Target, History, Map, Library, Shield, Ruler, Home, Trophy,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/user-menu'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { RaxcoreLogo } from '@/components/raxcore-logo'

// ─── Navigation entries (auth-aware) ─────────────────────────────────────────

const publicNavigation = [
  { name: 'Home',    href: '/',        icon: Home },
  { name: 'Score',   href: '/score',   icon: Target },
  { name: 'Measure', href: '/measure', icon: Ruler },
  { name: 'Map',     href: '/map',     icon: Map },
  { name: 'History', href: '/history', icon: History },
]

const authenticatedNavigation = [
  { name: 'Home',         href: '/',             icon: Home },
  { name: 'Score',        href: '/score',        icon: Target },
  { name: 'Measure',      href: '/measure',      icon: Ruler },
  { name: 'Library',      href: '/library',      icon: Library },
  { name: 'Trophy Room',  href: '/trophy-room',  icon: Trophy },
  { name: 'Map',          href: '/map',          icon: Map },
  { name: 'History',      href: '/history',      icon: History },
]

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: Shield },
]

interface HeaderProps {
  bellSlot?: React.ReactNode
  usageSlot?: React.ReactNode
}

// ─── Side panel contents ─────────────────────────────────────────────────────

function SidePanelContents({
  navigation,
  isActive,
  user,
  onClose,
}: {
  navigation: { name: string; href: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }[]
  isActive: (href: string) => boolean
  user: User | null
  onClose: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Top: brand + close */}
      <div
        className="flex items-center justify-between p-4"
        style={{ borderBottom: '1px solid var(--bronze-dark)' }}
      >
        <Link href="/" onClick={onClose} className="flex items-center">
          <RaxcoreLogo />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          style={{ color: 'var(--muted-foreground)' }}
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Navigation list */}
      <nav className="flex flex-col gap-1.5 p-3 flex-1 overflow-y-auto" aria-label="Main navigation">
        {navigation.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onClose}
              className="group relative flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-bold tracking-wider uppercase min-h-[48px] transition-all duration-200"
              style={
                active
                  ? {
                      background: 'linear-gradient(135deg, rgba(184,114,72,0.18) 0%, rgba(92,52,24,0.12) 100%)',
                      color: 'var(--bronze-light)',
                      border: '1px solid var(--bronze-dark)',
                      boxShadow: 'inset 0 1px 0 rgba(184,114,72,0.15), 0 2px 8px rgba(0,0,0,0.3)',
                    }
                  : {
                      color: 'var(--muted-foreground)',
                      border: '1px solid transparent',
                    }
              }
            >
              {/* Active indicator bar */}
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r"
                  style={{ background: 'var(--bronze-light)' }}
                />
              )}
              <item.icon
                className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110"
                style={{ color: active ? 'var(--bronze-light)' : 'var(--bronze-mid)' }}
              />
              <span className="transition-colors duration-200 group-hover:text-[var(--bronze-light)]">
                {item.name}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Auth CTAs (signed-out only) */}
      {!user && (
        <div className="p-4" style={{ borderTop: '1px solid var(--bronze-dark)' }}>
          <div className="flex flex-col gap-2">
            <Link
              href="/auth/sign-up"
              onClick={onClose}
              className="flex items-center justify-center min-h-[44px] rounded text-sm font-bold tracking-widest uppercase btn-bronze"
            >
              Get Started
            </Link>
            <Link
              href="/auth/login"
              onClick={onClose}
              className="flex items-center justify-center min-h-[44px] rounded text-xs font-bold tracking-widest uppercase"
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
  )
}

// ─── Public Header (slim top bar + collapsible side panel) ───────────────────

export function Header({ bellSlot, usageSlot }: HeaderProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => {
      setUser(user)
      if (user) {
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
          .then(({ data }: { data: { is_admin: boolean } | null }) => setIsAdmin(data?.is_admin || false))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user: User } | null) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .single()
            .then(({ data }: { data: { is_admin: boolean } | null }) => setIsAdmin(data?.is_admin || false))
        } else {
          setIsAdmin(false)
        }
      },
    )

    return () => subscription.unsubscribe()
  }, [supabase])

  const baseNavigation = user ? authenticatedNavigation : publicNavigation
  const fullNavigation = isAdmin ? [...baseNavigation, ...adminNavigation] : baseNavigation

  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(href + '/')

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: 'linear-gradient(180deg, #1c1814 0%, #161412 100%)',
        borderBottom: '1px solid var(--bronze-dark)',
        boxShadow: '0 1px 0 rgba(212,168,75,0.08), 0 2px 12px rgba(0,0,0,0.55)',
        height: 56,
      }}
    >
      <div className="flex h-14 items-center px-3 gap-2 max-w-screen-xl mx-auto">
        {/* Hamburger — opens collapsible side panel */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              style={{ color: 'var(--bronze-light)' }}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[280px] p-0"
            style={{
              background: '#1c1814',
              border: 'none',
              borderRight: '1px solid var(--bronze-dark)',
            }}
          >
            <SheetTitle className="sr-only">Main Navigation</SheetTitle>
            <SidePanelContents
              navigation={fullNavigation}
              isActive={isActive}
              user={user}
              onClose={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>

        {/* Logo (always visible, centered-left after hamburger) */}
        <Link href="/" className="flex items-center shrink-0" aria-label="Go to home">
          <RaxcoreLogo />
        </Link>

        {/* Right side: home / usage / bell / user */}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* Home button — hidden on homepage, visible on other pages */}
          {pathname !== '/' && (
            <Link
              href="/"
              aria-label="Go to home"
              className="flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200 hover:scale-105"
              style={{
                color: 'var(--bronze-mid)',
                background: 'transparent',
                border: '1px solid transparent',
              }}
            >
              <Home className="h-5 w-5" />
            </Link>
          )}
          <div className="hidden sm:block">{usageSlot}</div>
          {bellSlot}
          <UserMenu initialUser={user} />
        </div>
      </div>
    </header>
  )
}
