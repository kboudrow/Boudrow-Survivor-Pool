import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const backupDir = join(process.cwd(), 'backups')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const mode = process.argv.includes('--schema-only')
  ? 'schema'
  : process.argv.includes('--data-only')
    ? 'data'
    : process.argv.includes('--public-data-only')
      ? 'public-data'
      : 'recovery'
const command = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'

if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

function dump(file, extraArgs) {
  console.log(`Creating Supabase backup artifact: ${file}`)
  const result = spawnSync(
    command,
    ['db', 'dump', '--linked', ...extraArgs, '--file', file],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status)
}

if (mode === 'schema') {
  const file = join(backupDir, `supabase-schema-${timestamp}.sql`)
  dump(file, ['--schema', 'public'])
  console.log(`Backup written to ${file}`)
} else if (mode === 'data') {
  const file = join(backupDir, `supabase-data-${timestamp}.sql`)
  dump(file, ['--data-only'])
  console.log(`Backup written to ${file}`)
} else if (mode === 'public-data') {
  const file = join(backupDir, `supabase-public-data-${timestamp}.sql`)
  dump(file, ['--data-only', '--schema', 'public'])
  console.log(`Backup written to ${file}`)
} else {
  const bundleDir = join(backupDir, `supabase-recovery-${timestamp}`)
  mkdirSync(bundleDir, { recursive: true })
  const schemaFile = join(bundleDir, 'public-schema.sql')
  const publicDataFile = join(bundleDir, 'public-data.sql')
  const managedDataFile = join(bundleDir, 'managed-and-public-data.sql')
  dump(schemaFile, ['--schema', 'public'])
  dump(publicDataFile, ['--data-only', '--schema', 'public'])
  dump(managedDataFile, ['--data-only'])
  writeFileSync(
    join(bundleDir, 'RESTORE-NOTES.txt'),
    [
      'Restore public-schema.sql first, then public-data.sql.',
      'managed-and-public-data.sql includes Supabase-managed schemas such as Auth.',
      'Restore managed schemas only into a compatible Supabase version or use platform recovery.',
      'Storage objects are not included.',
      '',
    ].join('\n'),
  )
  console.log(`Recovery bundle written to ${bundleDir}`)
}
