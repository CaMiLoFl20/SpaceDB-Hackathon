import type { ChatMessage } from './llm';
import type { FundRiskProfile } from './models/funds';

export type LlmTradingPlanStep = {
  gameMinute: bigint;
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  shares: bigint;
  reasoning: string;
};

export type LlmTradingPlan = {
  thesis: string;
  riskPosture: string;
  steps: LlmTradingPlanStep[];
};

const VALID_SYMBOLS = new Set(['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN']);

export function maxPlanSharesForRisk(riskProfile: FundRiskProfile): bigint {
  if (riskProfile === 'conservative') return 800n;
  if (riskProfile === 'moderate') return 1_500n;
  return 3_000n;
}

export function buildTradingPlanLlmMessages(
  managerName: string,
  styleLabel: string,
  marketContext: string
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `You are ${managerName}, a competing fund manager (${styleLabel}).`,
        'Create a private trading plan for one compressed trading day.',
        'The simulated market is open from 9:30 AM to 4:00 PM ET.',
        'Return JSON only:',
        '{"thesis":"one sentence","risk_posture":"one sentence","steps":[{"game_minute":570,"action":"buy|sell|hold","symbol":"NVDA|AAPL|GOOGL|MSFT|AMZN or empty","shares":number,"reasoning":"one sentence"}]}',
        'Create exactly 6 steps. Use game_minute from 570 through 955. A hold step may use empty symbol and 0 shares.',
      ].join(' '),
    },
    { role: 'user', content: marketContext },
  ];
}

export function parseTradingPlanLlmResponse(
  text: string,
  riskProfile: FundRiskProfile
): LlmTradingPlan | undefined {
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
  const rawSteps = Array.isArray(entry.steps) ? entry.steps : [];
  const maxShares = maxPlanSharesForRisk(riskProfile);
  const steps = rawSteps
    .slice(0, 6)
    .map(raw => {
      if (!raw || typeof raw !== 'object') return undefined;
      const step = raw as Record<string, unknown>;
      const actionRaw =
        typeof step.action === 'string' ? step.action.trim().toLowerCase() : 'hold';
      const action =
        actionRaw === 'buy' || actionRaw === 'sell' || actionRaw === 'hold'
          ? actionRaw
          : 'hold';
      const symbol =
        typeof step.symbol === 'string' ? step.symbol.trim().toUpperCase() : '';
      const minuteNumber = Number(step.game_minute ?? step.gameMinute ?? 570);
      const sharesNumber = Number(step.shares ?? 0);
      const gameMinute = Number.isFinite(minuteNumber)
        ? BigInt(Math.min(955, Math.max(570, Math.floor(minuteNumber))))
        : 570n;
      const shares =
        Number.isFinite(sharesNumber) && sharesNumber > 0
          ? BigInt(Math.min(Number(maxShares), Math.floor(sharesNumber)))
          : 0n;
      const reasoning =
        typeof step.reasoning === 'string' ? step.reasoning.trim() : '';
      if (action !== 'hold' && !VALID_SYMBOLS.has(symbol)) return undefined;
      return {
        gameMinute,
        action,
        symbol: action === 'hold' ? '' : symbol,
        shares: action === 'hold' ? 0n : shares,
        reasoning,
      } satisfies LlmTradingPlanStep;
    })
    .filter((step): step is LlmTradingPlanStep => step != null);

  if (steps.length === 0) return undefined;
  return {
    thesis: typeof entry.thesis === 'string' ? entry.thesis.trim() : '',
    riskPosture:
      typeof entry.risk_posture === 'string'
        ? entry.risk_posture.trim()
        : typeof entry.riskPosture === 'string'
          ? entry.riskPosture.trim()
          : '',
    steps,
  };
}
