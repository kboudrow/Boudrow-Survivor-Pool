import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FAQ | Survive Sunday',
  description: 'Answers about Survive Sunday pool setup, pick deadlines, strikes, double-pick weeks, private pools, admin tools, and AdSense-safe use.',
  alternates: {
    canonical: '/faq',
  },
}

const faqs = [
  {
    question: 'What does Survive Sunday do?',
    answer:
      'Survive Sunday helps commissioners run NFL survivor pools online. You can create a pool, choose the rules, invite players, collect weekly picks, lock picks at the right time, and show standings without managing a spreadsheet.',
  },
  {
    question: 'Do players need an account?',
    answer:
      'Yes. Players sign in so their picks, used teams, profile, pool memberships, and history stay tied to the right person.',
  },
  {
    question: 'Can I make a private pool?',
    answer:
      'Yes. Commissioners can create private pools with a password and share an invite link. Public pools can appear in search, while private pools stay gated.',
  },
  {
    question: 'Can I set a custom start week?',
    answer:
      'Yes. If a pool starts in Week 3, players should not be able to make Week 1 or Week 2 picks. Double-pick weeks before the start week are filtered out too.',
  },
  {
    question: 'How do pick deadlines work?',
    answer:
      'Pools can use a Sunday 1 PM ET deadline, a before-Monday-night style deadline where unstarted games stay available longer, or rolling locks where each game locks at its own kickoff. Early games always lock once they kick off.',
  },
  {
    question: 'What happens if someone forgets to pick?',
    answer:
      'Once the pool deadline has passed, a missing pick can count as a no-pick loss. That keeps standings fair and avoids the commissioner having to chase everyone manually.',
  },
  {
    question: 'Can players reuse the same team?',
    answer:
      'No. Survive Sunday tracks used teams inside each pool and prevents repeat team picks for that player.',
  },
  {
    question: 'What are strikes or mulligans?',
    answer:
      'A strike is a loss. Commissioners can allow zero, one, or two misses before a player is eliminated. If a player still has strikes left, they stay alive.',
  },
  {
    question: 'What are double-pick weeks?',
    answer:
      'A double-pick week requires two picks instead of one. Commissioners choose those weeks before the pool starts, and both picks are tracked separately.',
  },
  {
    question: 'Can I have multiple entries?',
    answer:
      'Yes. Commissioners can allow multiple entries per member. Each entry plays independently with its own picks, used teams, standings row, and survival status.',
  },
  {
    question: 'Can I restart the same pool next season?',
    answer:
      'Yes. Run It Back is designed for commissioners who want to archive a completed pool and start a new season with similar settings instead of rebuilding everything from scratch.',
  },
  {
    question: 'Can I archive completed pools?',
    answer:
      'Yes. Archiving keeps old pools out of the active dashboard while preserving history. Pools should not be casually archived once the season is underway.',
  },
  {
    question: 'Can I change my pick after submitting?',
    answer:
      'Usually yes, as long as that pick has not locked. Once the selected game starts or the pool deadline passes, the pick becomes official and can no longer be changed by the player.',
  },
  {
    question: 'What happens if my team ties?',
    answer:
      'That depends on the pool settings. Commissioners can decide whether ties count as a win, a loss, or a push before the pool starts.',
  },
  {
    question: 'Can admins change pool settings later?',
    answer:
      'Pool settings are meant to lock once the pool reaches its configured start week. That protects fairness after players have already started making picks.',
  },
  {
    question: 'Can eliminated players still see the pool?',
    answer:
      'Yes. Eliminated players can still view matchups and standings, but they should not be able to make new picks.',
  },
  {
    question: 'Is this a betting or payout site?',
    answer:
      'No. Survive Sunday is a pool-management tool. It does not accept wagers, hold funds, manage prize pools, calculate payouts, or act as a sportsbook.',
  },
  {
    question: 'Where can I get help?',
    answer:
      'Email survivesunday1@gmail.com or use the Contact page. Include your pool name if the question is about a specific pool.',
  },
]

export default function FaqPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-xl border border-red-950 bg-[#090b0f] p-5 text-white shadow-sm sm:p-8">
          <p className="text-sm font-bold uppercase tracking-wide text-[#d2ad5b]">FAQ</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-normal sm:text-4xl">Questions commissioners and players actually ask</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            A quick guide to what Survive Sunday handles, how the rules work, and what players should expect once a pool is live.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {faqs.map((faq) => (
            <section key={faq.question} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{faq.question}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{faq.answer}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-[#d2ad5b]/40 bg-white p-5 text-sm text-slate-700">
          Still stuck? <Link href="/contact" className="font-semibold text-[#c5161d] hover:text-[#a91218]">Contact Survive Sunday</Link>.
        </div>
      </div>
    </main>
  )
}

