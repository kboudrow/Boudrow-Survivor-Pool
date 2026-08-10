export type BlogPost = {
  slug: string
  title: string
  description: string
  category: string
  publishedAt: string
  updatedAt: string
  readTime: string
  pinned?: boolean
  sections: {
    heading: string
    body: string[]
  }[]
}

export const blogCategories = [
  'Survivor Pools',
  'NFL',
  'NBA',
  'MLB',
  'NHL',
  'PGA',
  'Other Sports',
] as const

export const blogPosts: BlogPost[] = [
  {
    slug: 'how-nfl-survivor-pools-work',
    title: 'How NFL Survivor Pools Work',
    description: 'A simple guide to survivor pool rules, weekly picks, eliminations, mulligans, and no-repeat team strategy.',
    category: 'Survivor Pools',
    publishedAt: 'June 6, 2026',
    updatedAt: '2026-06-06',
    readTime: '4 min read',
    sections: [
      {
        heading: 'The basic idea',
        body: [
          'In an NFL survivor pool, each entry picks one team each week. If that team wins, the entry survives to the next week. If that team loses, it uses a mulligan when one is available or is eliminated when none remain.',
          'The twist is that most survivor pools do not allow repeat teams. Once you use a team, it is off your board for the rest of the season.',
        ],
      },
      {
        heading: 'Common rules',
        body: [
          'Most pools use one pick per week, but some add double-pick weeks to increase difficulty. On Survive Sunday, commissioners choose whether an official NFL tie counts as a win or a loss.',
          'Commissioners should make rules clear before Week 1: start week, pick deadline, mulligans allowed, tie rule, and whether playoffs are included.',
        ],
      },
      {
        heading: 'Why organization matters',
        body: [
          'Survivor pools get messy when picks are tracked by text messages or spreadsheets. The commissioner needs clean locks, clear standings, and a record of which teams each player has already used.',
          'A dedicated pool tool helps avoid arguments because picks, deadlines, and standings are visible in one place.',
        ],
      },
    ],
  },
  {
    slug: 'survivor-pool-strategy-for-beginners',
    title: 'Survivor Pool Strategy For Beginners',
    description: 'Beginner-friendly survivor pool strategy: avoid burning every favorite early, think about future weeks, and manage risk.',
    category: 'Survivor Pools',
    publishedAt: 'June 6, 2026',
    updatedAt: '2026-06-06',
    readTime: '5 min read',
    sections: [
      {
        heading: 'Do not only chase the biggest favorite',
        body: [
          'The safest team in Week 1 is not always the best survivor pick. If that same team has a much better matchup later, saving them can matter.',
          'Good survivor strategy balances current-week safety with future-week flexibility.',
        ],
      },
      {
        heading: 'Plan several weeks ahead',
        body: [
          'Before making a pick, look at the next few weeks and mark teams you may want to save. This does not need to be perfect, but it helps prevent using every strong team early.',
          'If two teams feel similarly safe this week, use the one with fewer future matchups you love.',
        ],
      },
      {
        heading: 'Know your pool size',
        body: [
          'Small pools often reward steady, safe picks. Large pools may require more contrarian choices because many players will pile onto the same favorite.',
          'The right strategy changes when there are 8 players versus 200 players.',
        ],
      },
    ],
  },
  {
    slug: 'how-to-run-a-survivor-pool',
    title: 'Commissioner Checklist: How To Run A Survivor Pool',
    description: 'A commissioner checklist for setting rules, collecting players, locking picks, and keeping standings clean.',
    category: 'Survivor Pools',
    publishedAt: 'June 6, 2026',
    updatedAt: '2026-06-06',
    readTime: '6 min read',
    pinned: true,
    sections: [
      {
        heading: 'Set rules before invites go out',
        body: [
          'Commissioners should decide the rules before players join. The biggest settings are start week, pick deadline, mulligans allowed, tie rule, double-pick weeks, and whether the pool is public or private.',
          'Changing pool settings after the season starts can cause trust problems, so lock those rules once the pool begins.',
        ],
      },
      {
        heading: 'Make picks easy to verify',
        body: [
          'Players should be able to confirm their own picks after saving them. Commissioners should be able to review pending and official picks without digging through messages.',
          'Clear pick history matters most when someone claims they submitted a pick before the deadline.',
        ],
      },
      {
        heading: 'Keep standings transparent',
        body: [
          'Standings should show which entries are alive or eliminated, each record, and mulligans remaining. The less mystery there is, the less commissioner drama there is.',
          'A good pool is fun because everyone trusts the rules and the standings.',
        ],
      },
    ],
  },
  {
    slug: 'survivor-pool-pick-deadlines',
    title: 'Survivor Pool Pick Deadlines: Fixed vs Rolling Locks',
    description: 'How fixed deadlines, rolling kickoff locks, and hybrid lock rules change the way players make survivor pool picks.',
    category: 'Survivor Pools',
    publishedAt: 'June 11, 2026',
    updatedAt: '2026-06-11',
    readTime: '5 min read',
    sections: [
      {
        heading: 'Fixed deadlines keep things simple',
        body: [
          'A fixed deadline gives every player one clear cutoff, usually before the Sunday early games. It is easy to explain and easy for commissioners to enforce.',
          'The tradeoff is that Thursday, Friday, or Saturday games need special handling. If a team plays before the fixed deadline, that team should lock at kickoff.',
        ],
      },
      {
        heading: 'Rolling locks give players more flexibility',
        body: [
          'Rolling locks let each matchup stay editable until its own kickoff. Players can wait on injury news and weather as long as their selected team has not started.',
          'This format feels fair, but it requires software to track every game clock correctly. Manual spreadsheets often struggle with rolling locks.',
        ],
      },
      {
        heading: 'Hybrid rules are often best',
        body: [
          'Many pools use a hybrid rule: each pick locks at the earlier of the team kickoff or the weekly fixed deadline. That prevents late swaps while still handling early-week games correctly.',
          'Whatever rule you choose, write it down before invites go out so players know exactly when their picks become official.',
        ],
      },
    ],
  },
  {
    slug: 'private-vs-public-survivor-pools',
    title: 'Private vs Public Survivor Pools',
    description: 'A practical guide to choosing public discovery, private invite links, passwords, and member limits for an NFL survivor pool.',
    category: 'Survivor Pools',
    publishedAt: 'June 11, 2026',
    updatedAt: '2026-06-11',
    readTime: '4 min read',
    sections: [
      {
        heading: 'Use public pools when you want discovery',
        body: [
          'Public pools are useful when you want friends, coworkers, or a broader community to find the pool without asking for a direct link.',
          'They work best with a clear pool name, a reasonable member limit, and rules that are easy for new players to understand.',
        ],
      },
      {
        heading: 'Use private pools for tighter control',
        body: [
          'Private pools are better for family groups, office pools, and invite-only contests. A password gives commissioners more control over who joins.',
          'Send the invite link and password separately when possible. It reduces accidental sharing and makes it easier to close the door before Week 1.',
        ],
      },
      {
        heading: 'Close invites once the pool starts',
        body: [
          'A survivor pool should stop accepting new members once its configured start week begins. Late entries can create fairness problems because early risk has already passed.',
          'The cleanest setup is to invite everyone early, open the pool, and let the invite button disappear automatically after the pool starts.',
        ],
      },
    ],
  },
  {
    slug: 'nfl-survivor-pool-rules-template',
    title: 'NFL Survivor Pool Rules Template',
    description: 'A copy-ready survivor pool rules template commissioners can send to their group before the season starts.',
    category: 'Survivor Pools',
    publishedAt: 'June 22, 2026',
    updatedAt: '2026-06-22',
    readTime: '5 min read',
    sections: [
      {
        heading: 'Use this before invites go out',
        body: [
          'Need a set of survivor pool rules you can send to your group? Use this template as-is or customize it for your pool.',
          'The most important thing is to make the rules clear before players join. Once picks start, changing rules can create trust problems fast.',
        ],
      },
      {
        heading: 'Basic rules',
        body: [
          'Each participant selects one NFL team to win its game each week. If the selected team wins, that entry advances to the next week.',
          'If the selected team loses, that entry uses a mulligan when one remains or is eliminated when none remain. Teams may only be used once during the regular season. The last remaining alive entry wins the pool.',
        ],
      },
      {
        heading: 'Pick deadlines',
        body: [
          'All picks must be submitted before the weekly deadline. Commissioners can choose fixed weekly deadlines, such as Sunday at 1:00 PM ET, or rolling kickoff locks where each game locks at kickoff.',
          'Late picks should not be accepted unless your rules clearly say otherwise. The cleaner rule is to decide the deadline format up front and apply it the same way for every entry.',
        ],
      },
      {
        heading: 'Tie games',
        body: [
          'Commissioners choose before the season whether an official NFL tie counts as a win or a loss. That choice applies to every entry for the full season.',
          'Tie rules seem minor until one actually happens. Put the rule in writing before Week 1 so there is no argument later.',
        ],
      },
      {
        heading: 'Multiple entries and double-pick weeks',
        body: [
          'If your pool allows multiple entries, each participant may have up to the number of entries set by the commissioner. Each entry should be treated independently with its own picks, standings position, and elimination status.',
          'During designated double-pick weeks, each alive entry must submit two different teams. Each pick is graded separately, so each loss uses a mulligan or moves the entry toward elimination.',
        ],
      },
      {
        heading: 'Missed picks and winner rules',
        body: [
          'If an entry has no pick at the deadline, Survive Sunday grades it as a loss. That loss uses a mulligan when one remains or eliminates the entry when none remain.',
          'The last remaining alive entry is declared the winner. If every remaining entry loses in the same week, they all stay alive for the following week and their losing teams still count as used.',
        ],
      },
      {
        heading: 'Make the rules easier to enforce',
        body: [
          'Want these rules enforced automatically? Create your pool on Survive Sunday and let the platform handle locks, standings, used teams, and elimination tracking.',
        ],
      },
    ],
  },
  {
    slug: 'fixed-deadline-vs-rolling-kickoff-locks',
    title: 'Fixed Deadline vs Rolling Kickoff Locks',
    description: 'A commissioner guide to choosing fixed weekly deadlines, rolling kickoff locks, or a hybrid approach for survivor pool picks.',
    category: 'Survivor Pools',
    publishedAt: 'June 22, 2026',
    updatedAt: '2026-06-22',
    readTime: '4 min read',
    sections: [
      {
        heading: 'Why lock rules matter',
        body: [
          'One of the most important decisions a commissioner makes is how picks lock each week. Survive Sunday supports both fixed deadlines and rolling kickoff locks, but each format creates a different experience.',
          'The right choice depends on your group. A casual office pool may value simplicity. A more competitive pool may want flexibility around injury news, weather, and primetime games.',
        ],
      },
      {
        heading: 'Fixed deadline locks',
        body: [
          'With a fixed deadline, all picks lock at a single time each week. A common example is Sunday at 1:00 PM ET. Once the deadline passes, nobody can make changes.',
          'Fixed deadlines are easy for commissioners to manage, simple for participants to understand, and good for creating a consistent weekly routine. They work especially well for office pools and casual pools.',
        ],
      },
      {
        heading: 'Fixed deadline tradeoffs',
        body: [
          'The downside is that early-week games can create complications. Thursday games, international games, and late injury news may all affect how players feel about their picks.',
          'A fixed deadline also gives participants less strategic flexibility. If your group likes waiting on late information, fixed locks may feel restrictive.',
        ],
      },
      {
        heading: 'Rolling kickoff locks',
        body: [
          'With rolling locks, each game locks individually at kickoff. A participant can wait until Sunday night or Monday night if they have not selected a team yet.',
          'Rolling locks offer maximum flexibility, let participants react to late-breaking news, and handle Thursday games naturally. They also create more strategic decision-making.',
        ],
      },
      {
        heading: 'Rolling lock tradeoffs',
        body: [
          'Rolling locks are slightly more complex for new players. They also require automated tracking to manage properly because each matchup has its own lock time.',
          'Trying to run rolling locks manually in a spreadsheet can get messy. If you choose this format, software should handle the clocks.',
        ],
      },
      {
        heading: 'Which option should you choose?',
        body: [
          'For most office pools and casual groups, fixed deadlines are easier. For competitive pools and experienced players, rolling kickoff locks typically provide the better experience.',
          'The good news is that Survive Sunday supports both formats, so commissioners can choose the rules that best fit their group.',
        ],
      },
    ],
  },
  {
    slug: 'what-to-do-when-someone-forgets-a-pick',
    title: 'What To Do When Someone Forgets To Submit Their Survivor Pool Pick',
    description: 'How commissioners can handle forgotten survivor pool picks without creating weekly arguments or special exceptions.',
    category: 'Survivor Pools',
    publishedAt: 'June 22, 2026',
    updatedAt: '2026-06-22',
    readTime: '6 min read',
    sections: [
      {
        heading: 'The text every commissioner gets',
        body: [
          'Every survivor pool commissioner eventually gets the same text message: "Wait, did I submit my pick?" The games are about to start, the participant forgot, and now everyone is looking to the commissioner for a ruling.',
          'How you handle missed picks can determine whether your pool stays fun or becomes a weekly argument.',
        ],
      },
      {
        heading: 'The biggest mistake commissioners make',
        body: [
          'The most common mistake is making decisions on the fly. You let one person submit a pick five minutes late. Then someone else asks for the same favor in Week 7.',
          'Before long, everyone has a different opinion about what is fair. The solution is simple: decide how missed picks will be handled before the season starts.',
        ],
      },
      {
        heading: 'How Survive Sunday handles a missed pick',
        body: [
          'A missing pick counts as a loss when the deadline passes. If that entry has a mulligan remaining, the loss uses it and the entry stays alive. If no mulligans remain, the entry is eliminated.',
          'The same rule is applied automatically to every entry, so the commissioner does not need to assign a team or decide who deserves an exception.',
        ],
      },
      {
        heading: 'What a mulligan changes',
        body: [
          'A mulligan is one allowed loss. For example, an entry with one mulligan survives its first loss or missed pick and is eliminated by its second.',
          'Mulligans belong to each entry. If one person owns two entries, a loss by Entry A does not change Entry B.',
        ],
      },
      {
        heading: 'Handling a genuine dispute',
        body: [
          'A forgotten pick is not the same as a technical or administrative error. If a player can show a real problem, the commissioner can correct the pick and record the reason.',
          'Locked-pick corrections are logged and the affected standings are recalculated. That audit trail keeps a correction from becoming an invisible special favor.',
        ],
      },
      {
        heading: 'Avoid special exceptions',
        body: [
          'Consistency matters. A missing pick should count as a loss for everyone, and commissioner corrections should be limited to documented errors.',
          'The commissioner should never have to make a judgment call based on who forgot. Good survivor pools run on clear rules, not commissioner discretion.',
        ],
      },
      {
        heading: 'The best approach',
        body: [
          'The easiest way to avoid disputes is to establish the rule before the season starts and enforce it automatically.',
          'Participants should know exactly what happens when they miss a deadline. Survive Sunday shows the deadline, saves choices immediately, locks them automatically, and applies the missed-pick loss consistently.',
        ],
      },
    ],
  },
]

export function sortBlogPosts<T extends BlogPost>(posts: T[] = blogPosts as T[]) {
  return [...posts].sort((a, b) => {
    const pinnedSort = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinnedSort) return pinnedSort
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug)
}

export function getFeaturedBlogPost() {
  return blogPosts.find((post) => post.pinned) || sortBlogPosts(blogPosts)[0]
}

export function getRelatedBlogPosts(post: BlogPost, limit = 3) {
  return sortBlogPosts(blogPosts)
    .filter((candidate) => candidate.slug !== post.slug)
    .sort((a, b) => {
      const aScore = a.category === post.category ? 1 : 0
      const bScore = b.category === post.category ? 1 : 0
      if (aScore !== bScore) return bScore - aScore
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
    .slice(0, limit)
}
