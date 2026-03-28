import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  GitBranch,
  RotateCcw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react'
import { getEventById, getTraceEvents } from '@/lib/monitoring/service'
import type { RuntimeEvent } from '@/lib/monitoring/service'

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
  if (status === 'failure') return <AlertTriangle className="h-5 w-5 text-destructive" />
  if (status === 'warning') return <AlertTriangle className="h-5 w-5 text-amber-500" />
  return <Info className="h-5 w-5 text-muted-foreground" />
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">success</Badge>
  if (status === 'failure') return <Badge variant="destructive">failure</Badge>
  if (status === 'warning') return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">warning</Badge>
  return <Badge variant="outline">{status}</Badge>
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground sm:w-44 shrink-0">{label}</dt>
      <dd className="text-sm mt-0.5 sm:mt-0 break-all">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

function TraceTimeline({ events, currentId }: { events: RuntimeEvent[]; currentId: string }) {
  if (events.length <= 1) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Trace Timeline
        </CardTitle>
        <CardDescription>All events sharing trace ID {events[0]?.trace_id}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative border-l border-border ml-3 space-y-4">
          {events.map((ev) => {
            const isCurrent = ev.id === currentId
            return (
              <li key={ev.id} className="ml-6">
                <span className={`absolute flex items-center justify-center w-3 h-3 rounded-full -left-1.5 border ${isCurrent ? 'bg-primary border-primary' : ev.status === 'failure' ? 'bg-destructive/40 border-destructive' : ev.status === 'success' ? 'bg-emerald-500/40 border-emerald-500' : 'bg-muted border-border'}`} />
                <div className={`p-2 rounded-lg border text-sm ${isCurrent ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-xs">{ev.event_type}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={ev.status} />
                      {ev.duration_ms != null && (
                        <span className="text-xs text-muted-foreground">{ev.duration_ms}ms</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(ev.created_at).toLocaleTimeString()} &middot; {ev.service}
                    {ev.fallback_used && <span className="ml-2 text-amber-500">fallback</span>}
                    {(ev.retry_count ?? 0) > 0 && <span className="ml-2 text-muted-foreground">{ev.retry_count} retries</span>}
                  </div>
                  {!isCurrent && (
                    <Link
                      href={`/admin/monitoring/event/${ev.id}`}
                      className="text-xs text-primary hover:underline underline-offset-2 mt-1 inline-block"
                    >
                      View event
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const event = await getEventById(id)

  if (!event) notFound()

  const traceEvents = event.trace_id ? await getTraceEvents(event.trace_id) : []

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/monitoring" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Monitoring
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusIcon status={event.status} />
          <div>
            <h1 className="text-xl font-bold font-mono">{event.event_type}</h1>
            <p className="text-sm text-muted-foreground">
              {new Date(event.created_at).toLocaleString()} &middot; {event.service}
            </p>
          </div>
        </div>
        <StatusBadge status={event.status} />
      </div>

      {/* Core fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field label="Event ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{event.id}</code>} />
            <Field label="Trace ID" value={
              event.trace_id
                ? <code className="text-xs bg-muted px-1 py-0.5 rounded">{event.trace_id}</code>
                : null
            } />
            <Field label="Service" value={event.service} />
            <Field label="Route" value={event.route} />
            <Field label="Status" value={<StatusBadge status={event.status} />} />
            <Field label="Timestamp" value={new Date(event.created_at).toISOString()} />
          </dl>
        </CardContent>
      </Card>

      {/* Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field
              label="Duration"
              value={event.duration_ms != null ? `${event.duration_ms}ms` : null}
            />
            <Field label="Images" value={event.images_count} />
          </dl>
        </CardContent>
      </Card>

      {/* Error info (only when failure/warning) */}
      {(event.status === 'failure' || event.status === 'warning') && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Error Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Field
                label="Error Type"
                value={
                  event.error_type ? (
                    <code className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                      {event.error_type}
                    </code>
                  ) : null
                }
              />
              <Field label="Error Message" value={event.error_message} />
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Model + calibration context */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model Context</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field label="Model Used" value={event.model_used} />
            <Field label="Model Version" value={event.model_version} />
            <Field label="Calibration Version" value={event.calibration_ver} />
          </dl>
        </CardContent>
      </Card>

      {/* Runtime flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runtime Flags</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field
              label="Fallback Used"
              value={
                event.fallback_used ? (
                  <span className="flex items-center gap-1 text-amber-600">
                    <GitBranch className="h-3.5 w-3.5" />
                    Yes
                  </span>
                ) : 'No'
              }
            />
            <Field
              label="Retry Count"
              value={
                (event.retry_count ?? 0) > 0 ? (
                  <span className="flex items-center gap-1">
                    <RotateCcw className="h-3.5 w-3.5" />
                    {event.retry_count}
                  </span>
                ) : '0'
              }
            />
          </dl>
        </CardContent>
      </Card>

      {/* Relations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relations</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field
              label="Buck ID"
              value={
                event.buck_id ? (
                  <Link
                    href={`/admin/submissions/${event.buck_id}`}
                    className="text-primary hover:underline underline-offset-2 font-mono text-xs"
                  >
                    {event.buck_id}
                  </Link>
                ) : null
              }
            />
            <Field label="Render Job ID" value={event.render_job_id} />
          </dl>
        </CardContent>
      </Card>

      {/* Metadata */}
      {Object.keys(event.metadata ?? {}).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
            <CardDescription>Additional context (no secrets stored here)</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Trace timeline */}
      <TraceTimeline events={traceEvents} currentId={event.id} />
    </div>
  )
}
