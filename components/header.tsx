'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Target, History, Shield, Map, Library } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { UserMenu } from '@/components/user-menu'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'

const publicNavigation = [
  { name: 'Score', href: '/score', icon: Target },
  { name: 'Map', href: '/map', icon: Map },
  { name: 'History', href: '/history', icon: History },
]

const authenticatedNavigation = [
  { name: 'Score', href: '/score', icon: Target },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Map', href: '/map', icon: Map },
]

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: Shield },
]

interface HeaderProps {
  bellSlot?: React.ReactNode
  usageSlot?: React.ReactNode
}

export function Header({ bellSlot, usageSlot }: HeaderProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (user) {
        // Check if admin
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
          .then(({ data }) => {
            setIsAdmin(data?.is_admin || false)
          })
      }
    })

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            setIsAdmin(data?.is_admin || false)
          })
      } else {
        setIsAdmin(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // Build navigation based on auth state
  const navigation = user ? authenticatedNavigation : publicNavigation
  const fullNavigation = isAdmin ? [...navigation, ...adminNavigation] : navigation

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4">
        <Link href="/" className="flex items-center gap-2 mr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            Rx
          </div>
          <span className="font-semibold text-lg tracking-tight">RAXcore</span>
        </Link>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {fullNavigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                pathname === item.href || pathname.startsWith(item.href + '/')
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Desktop user menu + usage badge + bell */}
        <div className="hidden md:flex items-center gap-2">
          {usageSlot}
          {bellSlot}
          <UserMenu initialUser={user} />
        </div>

        {/* Mobile menu */}
        <div className="flex flex-1 items-center justify-end gap-1 md:hidden">
          {bellSlot}
          <UserMenu initialUser={user} />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] p-0">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                      Rx
                    </div>
                    <span className="font-semibold">RAXcore</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <nav className="flex flex-col gap-1 p-4 flex-1">
                  {fullNavigation.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium transition-colors min-h-[48px]',
                        pathname === item.href || pathname.startsWith(item.href + '/')
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.name}
                    </Link>
                  ))}
                </nav>
                {/* Mobile auth actions in sheet */}
                {!user && (
                  <div className="p-4 border-t border-border">
                    <div className="flex flex-col gap-2">
                      <Button asChild className="min-h-[48px]">
                        <Link href="/auth/sign-up" onClick={() => setOpen(false)}>
                          Get Started
                        </Link>
                      </Button>
                      <Button variant="outline" asChild className="min-h-[48px]">
                        <Link href="/auth/login" onClick={() => setOpen(false)}>
                          Sign in
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
