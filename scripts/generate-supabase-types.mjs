import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const result = spawnSync(
  'npx supabase gen types typescript --linked --schema public',
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
  },
)

if (result.status !== 0 || !result.stdout.trim()) {
  if (result.error) console.error(result.error.message)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.status || 1)
}

writeFileSync(join(process.cwd(), 'supabase', 'database.types.ts'), result.stdout)
