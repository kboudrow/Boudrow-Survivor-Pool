import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FAQ | Survive Sunday',
  description: 'Answers about NFL survivor pools, weekly picks, mulligans, deadlines, double-pick weeks, private pools, and admin tools.',
  alternates: {
    canonical: '/faq',
  },
}

const faqs = [
  {
    question: 'What is an NFL survivor pool?',
    answer:
      'It is a weekly contest where each entry chooses one NFL team to win. A win keeps the entry alive. A loss uses a mulligan if one is available or eliminates the entry if none remain. The same team cannot normally be used twice.',
  },
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
      'Yes. Public pools can appear in search and do not need a password. Private pools require the invite link and password from the commissioner. A valid join is immediate in either case; Survive Sunday does not use a member-approval queue.',
  },
  {
    question: 'Can I set a custom start week?',
    answer:
      'Yes. If a pool starts in Week 3, players should not be able to make Week 1 or Week 2 picks. Double-pick weeks before the start week are filtered out too.',
  },
  {
    question: 'How do pick deadlines work?',
    answer:
      'Pools can use a Sunday 1 PM ET deadline or rolling locks where each game locks at its own kickoff. With the Sunday deadline, early games still lock once they kick off.',
  },
  {
    question: 'What happens if someone forgets to pick?',
    answer:
      'Once the deadline passes, a missing pick counts as a loss. It uses one mulligan if the entry has one remaining; otherwise the entry is eliminated.',
  },
  {
    question: 'Can players reuse the same team?',
    answer:
      'Not during the same phase of the season. Each entry has its own used-team history, so using Buffalo now removes Buffalo from that entry’s later regular-season choices. The history resets when the playoffs begin.',
  },
  {
    question: 'What is a mulligan?',
    answer:
      'A mulligan is one allowed loss. With zero mulligans, the first loss eliminates the entry. With one mulligan, the entry survives its first loss and is eliminated by its second.',
  },
  {
    question: 'What are double-pick weeks?',
    answer:
      'A double-pick week requires each alive entry to choose two different teams instead of one. Both picks save and lock separately, and each result is graded separately.',
  },
  {
    question: 'Can I have multiple entries?',
    answer:
      'Yes, when the commissioner allows it. An entry is one independent chance to play. Each of your entries has its own picks, used teams, mulligans, standings row, and alive or eliminated status. Always check which entry you are editing before choosing a team.',
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
      'The pool settings say whether an official NFL tie counts as a win or a loss. The same choice applies to every entry in that pool.',
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
    question: 'What should I do each week?',
    answer:
      'Open the pool, make sure the correct entry and week are selected, and choose the required team or teams before the displayed lock time. Look for “Saved — editable until lock.” Once a pick says “Locked — official,” it cannot be changed by the player.',
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
