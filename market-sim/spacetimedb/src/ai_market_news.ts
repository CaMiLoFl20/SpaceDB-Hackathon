import type { ChatMessage } from './llm';

export type LlmNewsDecision = {
  publish: boolean;
  headline: string;
  body: string;
  symbol: string | undefined;
  nextCheckSeconds: bigint;
  reasoning: string;
};

const VALID_SYMBOLS = new Set(['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN']);

export function buildAutoNewsLlmMessages(marketContext: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the live market news desk for a multiplayer stock simulator.',
        'React to recent retail trades, fund manager trades, and price/volume moves.',
        'Publish news only when something meaningful happened — do not repeat stale stories.',
        'If pending fund share or stock splits are listed, prioritize announcing those corporate actions before routine tape stories.',
        'Never name individual human players; use "retail traders", "institutional desks", "unusual volume", etc.',
        'Do not reveal fund management styles, strategy types, or distinguish between fund types.',
        'Respond with JSON only:',
        '{"publish":true|false,"headline":"...","body":"...","symbol":"TICKER or empty","next_check_seconds":number,"reasoning":"one sentence"}',
        'If publish is false, leave headline/body empty strings.',
        'next_check_seconds: how long until the desk should check again (25-180). Use shorter delays after heavy activity.',
      ].join(' '),
    },
    { role: 'user', content: marketContext },
  ];
}

function parseNextCheckSeconds(
  entry: Record<string, unknown>,
  defaultSeconds: number
): bigint {
  const raw = entry.next_check_seconds ?? entry.nextCheckSeconds ?? defaultSeconds;
  const n = Number(raw);
  if (!Number.isFinite(n)) return BigInt(defaultSeconds);
  return BigInt(Math.min(180, Math.max(25, Math.floor(n))));
}

export function parseAutoNewsLlmResponse(text: string): LlmNewsDecision | undefined {
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
  const publish = entry.publish === true || entry.publish === 'true';
  const headline = typeof entry.headline === 'string' ? entry.headline.trim() : '';
  const body = typeof entry.body === 'string' ? entry.body.trim() : '';
  const symbolRaw = typeof entry.symbol === 'string' ? entry.symbol.trim().toUpperCase() : '';
  const symbol =
    symbolRaw.length > 0 && VALID_SYMBOLS.has(symbolRaw) ? symbolRaw : undefined;
  const reasoning =
    typeof entry.reasoning === 'string' ? entry.reasoning.trim() : '';

  if (publish && (headline.length === 0 || body.length === 0)) return undefined;

  return {
    publish,
    headline,
    body,
    symbol,
    nextCheckSeconds: parseNextCheckSeconds(entry, publish ? 45 : 60),
    reasoning,
  };
}
