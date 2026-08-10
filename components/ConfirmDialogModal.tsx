'use client'

export type ConfirmDialog = {
  title: string
  message: string
  tone?: 'warning' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  resolve: (confirmed: boolean) => void
}

export function ConfirmDialogModal({ dialog, onClose }: { dialog: ConfirmDialog | null; onClose: () => void }) {
  if (!dialog) return null
  const danger = dialog.tone === 'danger'
  const headingClass = danger ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
  const buttonClass = danger ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-950 hover:bg-black'
  const choose = (confirmed: boolean) => {
    dialog.resolve(confirmed)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <button type="button" className="absolute inset-0 bg-slate-950/50" aria-label="Cancel action" onClick={() => choose(false)} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div id="confirm-dialog-title" className={`mb-4 rounded-md border px-3 py-2 text-sm font-semibold ${headingClass}`}>{dialog.title}</div>
        <p id="confirm-dialog-description" className="whitespace-pre-line text-sm leading-6 text-slate-700">{dialog.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => choose(false)} className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">{dialog.cancelLabel || 'Cancel'}</button>
          <button type="button" onClick={() => choose(true)} className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${buttonClass}`}>{dialog.confirmLabel || 'Continue'}</button>
        </div>
      </div>
    </div>
  )
}
