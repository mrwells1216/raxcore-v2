import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ error: 'Route temporarily disabled for maintenance' }, { status: 503 })
}

export async function POST() {
  return NextResponse.json({ error: 'Route temporarily disabled for maintenance' }, { status: 503 })
}

export async function PATCH() {
  return NextResponse.json({ error: 'Route temporarily disabled for maintenance' }, { status: 503 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Route temporarily disabled for maintenance' }, { status: 503 })
}
