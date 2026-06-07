export type DemoPlayerSeed = {
  name: string;
  identityHex: string;
  balanceCents: bigint;
  holdings: readonly { symbol: string; shares: bigint }[];
};

/** Fixed demo identities for the hackathon leaderboard (not fund managers). */
export const DEMO_PLAYERS: readonly DemoPlayerSeed[] = [
  {
    name: 'Alex',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d01',
    balanceCents: 850_000n,
    holdings: [{ symbol: 'CEDR', shares: 150n }],
  },
  {
    name: 'Jordan',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d02',
    balanceCents: 1_200_000n,
    holdings: [{ symbol: 'HARB', shares: 80n }],
  },
  {
    name: 'Sam',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d03',
    balanceCents: 620_000n,
    holdings: [{ symbol: 'APEX', shares: 200n }],
  },
  {
    name: 'Riley',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d04',
    balanceCents: 1_580_000n,
    holdings: [{ symbol: 'MKT1', shares: 100n }],
  },
  {
    name: 'Casey',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d05',
    balanceCents: 450_000n,
    holdings: [
      { symbol: 'CEDR', shares: 50n },
      { symbol: 'HARB', shares: 30n },
    ],
  },
  {
    name: 'Morgan',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d06',
    balanceCents: 1_110_000n,
    holdings: [
      { symbol: 'APEX', shares: 90n },
      { symbol: 'MKT2', shares: 60n },
    ],
  },
  {
    name: 'Taylor',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d07',
    balanceCents: 975_000n,
    holdings: [],
  },
  {
    name: 'Quinn',
    identityHex: '0000000000000000000000000000000000000000000000000000000000000d08',
    balanceCents: 730_000n,
    holdings: [{ symbol: 'MKT2', shares: 180n }],
  },
];
