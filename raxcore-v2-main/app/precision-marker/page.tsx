import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function PrecisionMarkerPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8 print:hidden">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">RAXcore Precision Marker</h1>
          <p className="text-sm text-muted-foreground">
            Use the 2 inch outer square as the known-size reference for Precision Mode.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href="/api/precision-marker?edge=2&unit=in" target="_blank" rel="noreferrer">
              <Printer className="h-4 w-4" />
              Open 2 inch marker
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/precision-marker?edge=50&unit=mm" target="_blank" rel="noreferrer">
              <Printer className="h-4 w-4" />
              Open 50 mm marker
            </a>
          </Button>
        </div>
      </section>

      <section className="mx-auto flex max-w-3xl justify-center px-5 pb-10 print:block print:max-w-none print:p-0">
        <img
          src="/api/precision-marker?edge=2&unit=in"
          alt="RAXcore 2 inch precision marker"
          className="h-auto w-full max-w-md border border-border bg-white print:w-[4in] print:max-w-none print:border-0"
        />
      </section>
    </main>
  )
}
