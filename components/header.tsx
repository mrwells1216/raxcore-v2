'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Target, History, Shield, Map } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Score', href: '/score', icon: Target },
  { name: 'Map', href: '/map', icon: Map },
  { name: 'History', href: '/history', icon: History },
  { name: 'Admin', href: '/admin', icon: Shield },
]

export function Header() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4">
        <Link href="/" className="flex items-center gap-2 mr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">Xr</div>
          <span className="font-semibold text-lg tracking-tight">xRack</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {navigation.map((item) => (
            <Link key={item.name} href={item.href} className={cn('flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors', pathname === item.href ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50')}>
              <item.icon className="h-4 w-4" />{item.name}
            </Link>
          ))}
        </nav>
        <div className="flex flex-1 justify-end md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9"><Menu className="h-5 w-5" /><span className="sr-only">Toggle menu</span></Button></SheetTrigger>
            <SheetContent side="right" className="w-[280px] p-0">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between p-4 border-b border-border"><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">Xr</div><span className="font-semibold">xRack</span></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}><X className="h-5 w-5" /></Button></div>
                <nav className="flex flex-col gap-1 p-4 flex-1">{navigation.map((item) => <Link key={item.name} href={item.href} onClick={() => setOpen(false)} className={cn('flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium transition-colors min-h-[48px]', pathname === item.href ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50')}><item.icon className="h-5 w-5" />{item.name}</Link>)}</nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
