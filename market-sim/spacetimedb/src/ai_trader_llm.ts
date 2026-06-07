import type { ChatMessage } from './llm';

export type LlmTraderDecision = {
  botName: string;
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  shares: bigint;
  reasoning: string;
  nextCheckSeconds: bigint;
};

const VALID_SYMBOLS = new Set(['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN']);

function parseNextCheckSeconds(
  entry: Record<string, unknown>,
  defaultSeconds: number
): bigint {
  const raw = entry.next_check_seconds ?? entry.nextCheckSeconds ?? defaultSeconds;
  const n = Number(raw);
  if (!Number.isFinite(n)) return BigInt(defaultSeconds);
  return BigInt(Math.min(120, Math.max(20, Math.floor(n))));
}

export function buildSingleTraderLlmMessages(
  botName: string,
  styleLabel: string,
  marketContext: string
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `You are ${botName}, a competing fund manager (${styleLabel}) in a live stock simulator.`,
        'Goal: maximize your fund portfolio value and beat the other public funds plus all humans.',
        'Trade only when you see an opportunity — you may hold and check again later.',
        'If cash cannot afford 1 share, sell holdings first.',
        'Respond with JSON only:',
        '{"action":"buy|sell|hold","symbol":"TICKER or empty","shares":number,"reasoning":"one sentence","next_check_seconds":number}',
        'next_check_seconds: when YOU want to evaluate again (20-120). Trade independently of the other bot.',
        'Rules: symbol NVDA/AAPL/GOOGL/MSFT/AMZN; shares 1-20; sell only what you own.',
      ].join(' '),
    },
    { role: 'user', content: marketContext },
  ];
}

export function parseSingleTraderLlmResponse(
  text: string,
  botName: string
): LlmTraderDecision | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }

  if (!parsed || typeof parsed !== 'object') return undefined;
  const entry = parsed as Record<string, unknown>;
  const actionRaw =
    typeof entry.action === 'string' ? entry.action.trim().toLowerCase() : 'hold';
  const action =
    actionRaw === 'buy' || actionRaw === 'sell' || actionRaw === 'hold'
      ? actionRaw
      : 'hold';
  const symbol =
    typeof entry.symbol === 'string' ? entry.symbol.trim().toUpperCase() : '';
  const sharesNumber = Number(entry.shares ?? 0);
  const shares =
    Number.isFinite(sharesNumber) && sharesNumber > 0
      ? BigInt(Math.min(20, Math.max(0, Math.floor(sharesNumber))))
      : 0n;
  const reasoning =
    typeof entry.reasoning === 'string' ? entry.reasoning.trim() : '';

  if (action !== 'hold' && !VALID_SYMBOLS.has(symbol)) return undefined;
  if (action !== 'hold' && shares === 0n) return undefined;

  return {
    botName,
    action,
    symbol: action === 'hold' ? '' : symbol,
    shares: action === 'hold' ? 0n : shares,
    reasoning,
    nextCheckSeconds: parseNextCheckSeconds(entry, action === 'hold' ? 45 : 35),
  };
}
