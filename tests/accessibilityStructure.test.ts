import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('primary navigation and product preview expose semantic labels', async () => {
  const [header, preview] = await Promise.all([
    read('components/AppHeader.tsx'),
    read('components/HomeProductPreview.tsx'),
  ])
  assert.match(header, /aria-label="Primary navigation"/)
  assert.match(preview, /role="tablist"/)
  assert.match(preview, /aria-selected=/)
  assert.match(preview, /role="tabpanel"/)
})

test('authenticated dialogs identify themselves and their labels', async () => {
  const [dialog, poolPage, adminPage] = await Promise.all([
    read('components/AppDialogModal.tsx'),
    read('app/pools/page.tsx'),
    read('components/ConfirmDialogModal.tsx'),
  ])
  assert.match(dialog, /role="alertdialog"/)
  assert.match(dialog, /aria-modal="true"/)
  assert.match(poolPage, /role="dialog"/)
  assert.match(adminPage, /role="alertdialog"/)
})

test('account and pool discovery dialogs preserve semantic interaction', async () => {
  const [home, search] = await Promise.all([read('app/page.tsx'), read('app/join/search/page.tsx')])
  assert.match(home, /role="dialog" aria-modal="true"/)
  assert.match(search, /aria-label=\{`View \$\{pool\.name\} pool details`\}/)
  assert.match(search, /role="dialog" aria-modal="true"/)
})

test('public pool search returns ownership booleans instead of creator ids', async () => {
  const migration = await read('supabase/migrations/20260809000100_search_pool_identity_privacy.sql')
  const returnSignature = migration.slice(migration.indexOf('returns table'), migration.indexOf('language sql'))
  assert.doesNotMatch(returnSignature, /created_by/)
  assert.match(returnSignature, /owned_by_me boolean/)
  assert.match(returnSignature, /already_joined boolean/)
})

test('standings table has a caption and a keyboard-scrollable region', async () => {
  const poolPage = await read('app/pools/page.tsx')
  assert.match(poolPage, /<caption className="sr-only">/)
  assert.match(poolPage, /tabIndex=\{0\} role="region"/)
  assert.match(poolPage, /scope="row"/)
})

test('test mode exposes a guided week workflow and double-pick status', async () => {
  const adminPage = await read('app/pools/[poolId]/admin/page.tsx')
  assert.match(adminPage, /Start This Week/)
  assert.match(adminPage, /Finish Week & Score/)
  assert.match(adminPage, /Pick slots filled/)
  assert.match(adminPage, /2 picks required/)
  assert.match(adminPage, /aria-pressed=\{testClockStage === stage\.value\}/)
})
