'use client'

export type AppDialog = {
  title: string
  message: string
  tone?: 'info' | 'warning' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void | Promise<void>
}

export function AppDialogModal({ dialog, onClose }: { dialog: AppDialog | null; onClose: () => void }) {
  if (!dialog) return null
  const toneClass = dialog.tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700'
    : dialog.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-blue-200 bg-blue-50 text-blue-700'
  const buttonClass = dialog.tone === 'danger' ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-950 hover:bg-black'
  const confirm = async () => {
    const action = dialog.onConfirm
    onClose()
    await action?.()
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <button type="button" className="absolute inset-0 bg-slate-950/50" aria-label="Close dialog" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div id="app-dialog-title" className={`mb-4 rounded-md border px-3 py-2 text-sm font-semibold ${toneClass}`}>{dialog.title}</div>
        <p id="app-dialog-message" className="text-sm leading-6 text-slate-700">{dialog.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {dialog.cancelLabel && <button type="button" onClick={onClose} className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">{dialog.cancelLabel}</button>}
          <button type="button" onClick={confirm} className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${buttonClass}`}>{dialog.confirmLabel || 'Got it'}</button>
        </div>
      </div>
    </div>
  )
}
