import type { ChatMessage } from './llm';

export type LlmTraderDecision = {
  botName: string;
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  shares: bigint;
  reasoning: string;
};

const VALID_SYMBOLS = new Set(['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN']);

export function buildTraderLlmMessages(marketContext: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You control two competing AI traders in a simulated stock market.',
        'Goal: maximize portfolio value and beat the other AI plus all human players.',
        'Use prior reasoning and results to adapt — cut losers, press winners, respect cash limits.',
        'Nova AI is aggressive (momentum, larger bites). Pulse AI is conservative (dips, small size, take profits).',
        'CRITICAL: Each tick at least ONE bot must buy or sell — idle holds lose the game.',
        'If cash cannot afford 1 share of any stock, that bot MUST sell some holdings to free cash.',
        'Respond with JSON only — no markdown — as an array of exactly 2 objects:',
        '[{"trader":"Nova AI","action":"buy|sell|hold","symbol":"TICKER","shares":number,"reasoning":"one sentence"},',
        '{"trader":"Pulse AI","action":"buy|sell|hold","symbol":"TICKER","shares":number,"reasoning":"one sentence"}]',
        'Rules: symbol must be NVDA, AAPL, GOOGL, MSFT, or AMZN; shares 1-20; sell only shares you own; hold only if truly no valid trade exists.',
      ].join(' '),
    },
    { role: 'user', content: marketContext },
  ];
}

export function parseTraderLlmResponse(text: string): LlmTraderDecision[] | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayStart < 0 || arrayEnd <= arrayStart) return undefined;
    try {
      parsed = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    } catch {
      return undefined;
    }
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const decisions: LlmTraderDecision[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const botName = typeof entry.trader === 'string' ? entry.trader.trim() : '';
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

    if (botName !== 'Nova AI' && botName !== 'Pulse AI') continue;
    if (action !== 'hold' && !VALID_SYMBOLS.has(symbol)) continue;
    if (action === 'hold') {
      decisions.push({ botName, action, symbol: '', shares: 0n, reasoning });
      continue;
    }
    if (shares === 0n) continue;

    decisions.push({ botName, action, symbol, shares, reasoning });
  }

  if (decisions.length === 0) return undefined;

  const byName = new Map<string, LlmTraderDecision>();
  for (const decision of decisions) {
    byName.set(decision.botName, decision);
  }

  return [...byName.values()];
}
