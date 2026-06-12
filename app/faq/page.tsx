import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FAQ | Survive Sunday',
  description: 'Answers to common NFL survivor pool questions for commissioners and players.',
}

const faqs = [
  {
    question: 'Do players need an account?',
    answer: 'Yes. Players need to sign in so picks, used teams, standings, and history can be saved securely.',
  },
  {
    question: 'Can a pool be private?',
    answer: 'Yes. Commissioners can create private pools and share access only with the people they want to invite.',
  },
  {
    question: 'Can league settings change after the season starts?',
    answer: 'No. Once a pool reaches its configured start week, league settings lock. Admins can still manage player picks and results.',
  },
  {
    question: 'What are double-pick weeks?',
    answer: 'A double-pick week requires each player to make two picks instead of one. Commissioners choose those weeks before the league starts.',
  },
  {
    question: 'Is this a betting site?',
    answer: 'No. Survive Sunday is built to manage rules, picks, locks, and standings. It does not process wagers or payouts.',
  },
]

export default function FaqPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">FAQ</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Frequently asked questions</h1>
        <div className="mt-8 grid gap-4">
          {faqs.map((faq) => (
            <section key={faq.question} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{faq.question}</h2>
              <p className="mt-2 text-slate-600">{faq.answer}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
