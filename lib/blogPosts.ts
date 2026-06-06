export type BlogPost = {
  slug: string
  title: string
  description: string
  publishedAt: string
  readTime: string
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
    publishedAt: 'June 6, 2026',
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
    publishedAt: 'June 6, 2026',
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
    title: 'How To Run A Survivor Pool',
    description: 'A commissioner checklist for setting rules, collecting players, locking picks, and keeping standings clean.',
    publishedAt: 'June 6, 2026',
    readTime: '6 min read',
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
]

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug)
}
