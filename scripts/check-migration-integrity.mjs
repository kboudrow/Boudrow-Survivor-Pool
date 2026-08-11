import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const root = process.cwd()
const migrationDir = join(root, 'supabase', 'migrations')
const manifestPath = join(root, 'supabase', 'applied-migration-checksums.json')
const expected = JSON.parse(readFileSync(manifestPath, 'utf8'))
const files = readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort()
const errors = []
const versions = new Set()

for (const file of files) {
  const version = file.slice(0, 14)
  if (!/^\d{14}$/.test(version)) errors.push(`${file}: invalid timestamp prefix`)
  if (versions.has(version)) errors.push(`${file}: duplicate migration version ${version}`)
  versions.add(version)
}

for (const [file, expectedHash] of Object.entries(expected)) {
  if (!files.includes(file)) {
    errors.push(`${file}: applied migration is missing`)
    continue
  }
  const actualHash = createHash('sha256')
    .update(readFileSync(join(migrationDir, file)))
    .digest('hex')
  if (actualHash !== expectedHash) {
    errors.push(`${file}: applied migration was modified; add a forward migration instead`)
  }
}

const baseline = readFileSync(join(migrationDir, files[0]), 'utf8')
if (!baseline.includes('Baseline marker for the existing production database.')) {
  errors.push(`${basename(files[0])}: immutable legacy baseline marker changed unexpectedly`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`Migration integrity OK: ${Object.keys(expected).length} applied file(s) match recorded checksums; ${files.length} version(s) are unique.`)
