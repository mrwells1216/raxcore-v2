import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'RAXcore - AI Antler Scoring',
  description: 'AI-powered whitetail antler scoring from photos. Get estimated Boone & Crockett style scores using anatomical scaling references.',
  generator: 'v0.app',
  keywords: ['antler scoring', 'whitetail deer', 'Boone and Crockett', 'buck scoring', 'AI scoring', 'deer hunting'],
  authors: [{ name: 'RAXcore' }],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#6b4c3a' },
    { media: '(prefers-color-scheme: dark)', color: '#3d2a1f' },
  ],
}

console.log("[v0] ENV CHECK", {
  supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  openai: !!process.env.OPENAI_API_KEY,
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased min-h-svh">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
