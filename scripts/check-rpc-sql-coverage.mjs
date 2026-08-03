import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const codeRoots = ['app', 'components', 'lib', 'scripts']
const migrationRoot = path.join(root, 'supabase', 'migrations')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

const codeFiles = codeRoots
  .flatMap((dir) => walk(path.join(root, dir)))
  .filter((file) => /\.(mjs|js|ts|tsx)$/.test(file))

const rpcCalls = new Map()
for (const file of codeFiles) {
  const text = read(file)
  for (const match of text.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
    const fn = match[1]
    const rel = path.relative(root, file)
    const refs = rpcCalls.get(fn) || []
    refs.push(rel)
    rpcCalls.set(fn, refs)
  }
}

const migrationFiles = walk(migrationRoot).filter((file) => file.endsWith('.sql'))
const migrationDefs = new Set()
for (const file of migrationFiles) {
  const text = read(file)
  for (const match of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)/gi)) {
    migrationDefs.add(match[1])
  }
}

const missing = [...rpcCalls.keys()].sort().filter((fn) => !migrationDefs.has(fn))

if (missing.length > 0) {
  console.error('RPC calls missing from supabase/migrations:')
  for (const fn of missing) {
    const refs = [...new Set(rpcCalls.get(fn))].sort().join(', ')
    console.error(`- ${fn}: ${refs}`)
  }
  process.exit(1)
}

console.log(`RPC coverage OK: ${rpcCalls.size} app-called function(s) represented in supabase/migrations.`)
