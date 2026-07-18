import { spawnSync } from 'node:child_process'

const command = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
const result = spawnSync(command, process.argv.slice(2), {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: '1',
  },
  shell: false,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)

