import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !serviceKey) throw new Error('Missing Supabase server environment variables.')

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const schemaResponse = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/openapi+json' },
})
if (!schemaResponse.ok) throw new Error(`Could not inspect public schema: ${schemaResponse.status}`)
const schema = await schemaResponse.json()
const tableNames = Object.keys(schema.definitions || {}).filter((name) => !name.includes('.')).sort()

const backup = { created_at: new Date().toISOString(), source: new URL(url).host, auth_users: [], tables: {}, failures: {} }
for (let page = 1; ; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  backup.auth_users.push(...data.users)
  if (data.users.length < 1000) break
}

for (const table of tableNames) {
  const rows = []
  let failed = null
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('*').range(from, from + 999)
    if (error) {
      failed = error.message
      break
    }
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  if (failed) backup.failures[table] = failed
  else backup.tables[table] = rows
}

const backupDir = path.join(process.cwd(), 'backups')
await mkdir(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const output = path.join(backupDir, `supabase-api-${stamp}.json`)
await writeFile(output, JSON.stringify(backup))
console.log(`API backup written to ${output}`)
console.log(`Captured ${backup.auth_users.length} auth users and ${Object.keys(backup.tables).length} public relations.`)
if (Object.keys(backup.failures).length) console.log(`Unreadable relations: ${Object.keys(backup.failures).join(', ')}`)
