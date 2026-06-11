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

export const blogPosts: BlogPost[] = [
  {
    slug: 'how-nfl-survivor-pools-work',
    title: 'How NFL Survivor Pools Work',
    description: 'A simple guide to survivor pool rules, weekly picks, eliminations, strikes, and no-repeat team strategy.',
    category: 'Rules',
    publishedAt: 'June 6, 2026',
    updatedAt: '2026-06-06',
    readTime: '4 min read',
    sections: [
      {
        heading: 'The basic idea',
        body: [
          'In an NFL survivor pool, each player picks one team each week. If that team wins, the player survives to the next week. If that team loses, the player takes a strike or is eliminated depending on the pool rules.',
          'The twist is that most survivor pools do not allow repeat teams. Once you use a team, it is off your board for the rest of the season.',
        ],
      },
      {
        heading: 'Common rules',
        body: [
          'Most pools use one pick per week, but some add double-pick weeks to increase difficulty. Pools can also decide whether ties count as wins, losses, or pushes.',
          'Commissioners should make rules clear before Week 1: start week, pick deadline, strike limit, tie rule, and whether playoffs are included.',
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
    category: 'Strategy',
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
    category: 'Commissioner',
    publishedAt: 'June 6, 2026',
    updatedAt: '2026-06-06',
    readTime: '6 min read',
    pinned: true,
    sections: [
      {
        heading: 'Set rules before invites go out',
        body: [
          'Commissioners should decide the rules before players join. The biggest settings are start week, pick deadline, strike limit, tie rule, double-pick weeks, and whether the pool is public or private.',
          'Changing league settings after the season starts can cause trust problems, so lock those rules once the pool begins.',
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
          'Standings should show who is alive, who is eliminated, each player record, and strikes used. The less mystery there is, the less commissioner drama there is.',
          'A good pool is fun because everyone trusts the rules and the standings.',
        ],
      },
    ],
  },
  {
    slug: 'survivor-pool-pick-deadlines',
    title: 'Survivor Pool Pick Deadlines: Fixed vs Rolling Locks',
    description: 'How fixed deadlines, rolling kickoff locks, and hybrid lock rules change the way players make survivor pool picks.',
    category: 'Rules',
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
    category: 'Commissioner',
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
          'Private pools are better for family groups, office leagues, and invite-only contests. A password gives commissioners more control over who joins.',
          'Send the invite link and password separately when possible. It reduces accidental sharing and makes it easier to close the door before Week 1.',
        ],
      },
      {
        heading: 'Close invites once the pool starts',
        body: [
          'A survivor pool should stop accepting new members once its configured start week begins. Late entries can create fairness problems because early risk has already passed.',
          'The cleanest setup is to invite everyone early, activate the pool, and let the invite button disappear automatically after the league starts.',
        ],
      },
    ],
  },
]

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug)
}
