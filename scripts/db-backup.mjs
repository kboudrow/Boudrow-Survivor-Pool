import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const backupDir = join(process.cwd(), 'backups')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const mode = process.argv.includes('--schema-only')
  ? 'schema'
  : process.argv.includes('--data-only')
    ? 'data'
    : 'full'

const file = join(backupDir, `supabase-${mode}-${timestamp}.sql`)
const command = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'

if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

const args = ['db', 'dump', '--linked', '--file', file]
if (mode === 'schema') args.splice(2, 0, '--schema', 'public')
if (mode === 'data') args.splice(2, 0, '--data-only')

console.log(`Creating ${mode} Supabase backup: ${file}`)
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status)
}

console.log(`Backup written to ${file}`)
