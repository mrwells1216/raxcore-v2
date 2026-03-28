'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  LayoutDashboard, 
  Database, 
  TrendingUp, 
  Wand2, 
  FileDown,
  Target,
  ChevronLeft,
  Menu,
  BarChart3,
  FlaskConical,
  GitCompare,
  Settings2,
  Package,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Accuracy', href: '/admin/accuracy', icon: Target },
  { name: 'Calibration', href: '/admin/calibration', icon: Settings2 },
  { name: 'Benchmarks', href: '/admin/benchmarks', icon: Package },
  { name: 'Validation', href: '/admin/validation', icon: FlaskConical },
  { name: 'Bulk Testing', href: '/admin/bulk-validation', icon: GitCompare },
  { name: 'Submissions', href: '/admin/submissions', icon: Database },
  { name: 'Training Data', href: '/admin/training', icon: TrendingUp },
  { name: 'Error Patterns', href: '/admin/error-patterns', icon: BarChart3 },
  { name: 'Teach AI', href: '/admin/teach', icon: Wand2 },
  { name: 'Export', href: '/admin/export', icon: FileDown },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-14 px-4 border-b border-border bg-background">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">Xr</div>
          <span className="font-semibold">xRack Admin</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile nav drawer */}
      {!collapsed && (
        <div 
          className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setCollapsed(true)}
        />
      )}
      
      <aside className={cn(
        'fixed lg:sticky top-0 left-0 z-50 h-svh w-64 border-r border-border bg-sidebar transition-transform lg:translate-x-0',
        collapsed ? '-translate-x-full' : 'translate-x-0'
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-border">
            <Link href="/admin" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">Xr</div>
              <span className="font-semibold text-sidebar-foreground">xRack Admin</span>
            </Link>
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden h-8 w-8"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/admin' && pathname.startsWith(item.href))
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setCollapsed(true)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px]',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t border-sidebar-border">
            <Link
              href="/"
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors min-h-[44px]"
            >
              <ChevronLeft className="h-5 w-5" />
              Back to App
            </Link>
          </div>
        </div>
      </aside>

      {/* Spacer for mobile */}
      <div className="lg:hidden h-14" />
    </>
  )
}
