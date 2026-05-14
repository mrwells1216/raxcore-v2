/**
 * seed-roboflow-dataset.ts
 *
 * Imports a Roboflow dataset into the seed_training_images table.
 * Only imports detection labels (bounding boxes + class names) — no score data.
 *
 * Usage:
 *   ROBOFLOW_API_KEY=xxx ROBOFLOW_WORKSPACE=my-ws ROBOFLOW_PROJECT=deer-antlers \
 *   ROBOFLOW_VERSION=1 pnpm tsx scripts/seed-roboflow-dataset.ts
 *
 * Optional env vars:
 *   ROBOFLOW_SPLIT  — "train", "valid", "test", or "all" (default "all")
 *   DRY_RUN         — set to "1" to log rows without inserting
 */

import { createClient } from '@supabase/supabase-js'

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ROBOFLOW_API_KEY,
  ROBOFLOW_WORKSPACE,
  ROBOFLOW_PROJECT,
  ROBOFLOW_VERSION,
  ROBOFLOW_SPLIT = 'all',
  DRY_RUN,
} = process.env

function require(name: string, value: string | undefined): string {
  if (!value) { console.error(`Missing env: ${name}`); process.exit(1) }
  return value
}

const supabaseUrl = require('NEXT_PUBLIC_SUPABASE_URL', NEXT_PUBLIC_SUPABASE_URL)
const serviceKey = require('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)
const apiKey = require('ROBOFLOW_API_KEY', ROBOFLOW_API_KEY)
const workspace = require('ROBOFLOW_WORKSPACE', ROBOFLOW_WORKSPACE)
const project = require('ROBOFLOW_PROJECT', ROBOFLOW_PROJECT)
const version = require('ROBOFLOW_VERSION', ROBOFLOW_VERSION)

const isDryRun = DRY_RUN === '1'
const supabase = createClient(supabaseUrl, serviceKey)

interface RoboflowAnnotation {
  x: number; y: number; width: number; height: number; class: string
}
interface RoboflowImage {
  id: string
  file_name: string
  width: number
  height: number
}
interface RoboflowExport {
  images?: Array<RoboflowImage & { annotations?: RoboflowAnnotation[] }>
  license?: string
  info?: { description?: string }
}

async function fetchRoboflowExport(split: string): Promise<RoboflowExport> {
  const url = `https://api.roboflow.com/${workspace}/${project}/${version}/coco?api_key=${apiKey}&split=${split}`
  console.log(`Fetching Roboflow COCO export: ${workspace}/${project}/${version} split=${split}`)
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Roboflow API error ${res.status}: ${body}`)
  }
  return res.json()
}

interface SeedRow {
  source: string
  image_url: string
  bbox: object | null
  class_name: string | null
  license: string | null
  attribution: string | null
}

async function run() {
  const splits = ROBOFLOW_SPLIT === 'all' ? ['train', 'valid', 'test'] : [ROBOFLOW_SPLIT]
  const rows: SeedRow[] = []
  const source = `roboflow:${workspace}/${project}:${version}`

  for (const split of splits) {
    let data: RoboflowExport
    try {
      data = await fetchRoboflowExport(split)
    } catch (err) {
      console.warn(`  Skipping split "${split}": ${err}`)
      continue
    }

    const images = data.images ?? []
    const license = data.license ?? null
    const attribution = data.info?.description ?? null

    for (const img of images) {
      const anns = img.annotations ?? []
      if (anns.length === 0) {
        rows.push({
          source,
          image_url: img.file_name,
          bbox: null,
          class_name: null,
          license,
          attribution,
        })
      } else {
        for (const ann of anns) {
          rows.push({
            source,
            image_url: img.file_name,
            bbox: { x: ann.x, y: ann.y, width: ann.width, height: ann.height, img_width: img.width, img_height: img.height },
            class_name: ann.class,
            license,
            attribution,
          })
        }
      }
    }

    console.log(`  Split "${split}": ${images.length} images → ${rows.length} rows so far`)
  }

  if (rows.length === 0) {
    console.log('No rows to insert.')
    return
  }

  if (isDryRun) {
    console.log(`DRY RUN — would insert ${rows.length} rows:`)
    console.log(JSON.stringify(rows.slice(0, 3), null, 2), '...')
    return
  }

  // Batch insert in chunks of 500
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('seed_training_images').insert(chunk)
    if (error) {
      console.error(`Insert error at chunk ${i / CHUNK}:`, error.message)
      process.exit(1)
    }
    inserted += chunk.length
    console.log(`  Inserted ${inserted}/${rows.length}`)
  }

  console.log(`Done. ${inserted} rows inserted into seed_training_images.`)
}

run().catch(err => { console.error(err); process.exit(1) })
