'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { User as UserIcon, Library, LogOut, Settings, LogIn, CreditCard } from 'lucide-react'

interface UserMenuProps {
  initialUser?: User | null
}

export function UserMenu({ initialUser }: UserMenuProps) {
  const [user, setUser] = useState<User | null>(initialUser || null)
  const [loading, setLoading] = useState(!initialUser)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Check initial auth state if not provided
    if (!initialUser) {
      supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => {
        setUser(user)
        setLoading(false)
      })
    }

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: string, session: import('@supabase/supabase-js').Session | null) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase, initialUser])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
    )
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button 
          variant="ghost" 
          size="sm" 
          asChild 
          className="hidden sm:flex text-xs font-bold tracking-wider uppercase"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Link href="/auth/login">
            Sign in
          </Link>
        </Button>
        <Button 
          size="sm" 
          asChild
          className="btn-bronze text-xs font-bold tracking-wider uppercase px-4"
        >
          <Link href="/auth/sign-up" className="flex items-center gap-2">
            <LogIn className="h-4 w-4 sm:hidden" />
            <span className="hidden sm:inline">Get Started</span>
          </Link>
        </Button>
      </div>
    )
  }

  const initials = user.user_metadata?.display_name?.slice(0, 2).toUpperCase() 
    || user.email?.slice(0, 2).toUpperCase() 
    || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          className="relative h-10 w-10 rounded-full p-0 transition-all duration-200 hover:scale-105"
          style={{ 
            background: 'linear-gradient(145deg, var(--bronze-mid), var(--bronze-dark))',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,200,100,0.2)',
          }}
        >
          <Avatar className="h-10 w-10">
            <AvatarFallback 
              className="text-sm font-bold tracking-wider"
              style={{ 
                background: 'transparent',
                color: '#0d0a06',
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user.user_metadata?.display_name || 'User'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/library" className="flex items-center cursor-pointer">
            <Library className="mr-2 h-4 w-4" />
            My Library
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/plan" className="flex items-center cursor-pointer">
            <CreditCard className="mr-2 h-4 w-4" />
            Plan &amp; Usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
