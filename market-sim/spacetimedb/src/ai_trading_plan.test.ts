import { describe, expect, it } from 'vitest';
import { maxPlanSharesForRisk, parseTradingPlanLlmResponse } from './ai_trading_plan';

describe('trading plan parser', () => {
  it('parses and clamps LLM plan steps', () => {
    const plan = parseTradingPlanLlmResponse(
      JSON.stringify({
        thesis: 'Momentum day.',
        risk_posture: 'Aggressive but controlled.',
        steps: [
          {
            game_minute: 500,
            action: 'buy',
            symbol: 'NVDA',
            shares: 10_000,
            reasoning: 'Early strength.',
          },
        ],
      }),
      'moderate'
    );
    expect(plan?.steps[0]?.gameMinute).toBe(570n);
    expect(plan?.steps[0]?.shares).toBe(1_500n);
  });

  it('sets risk-based caps', () => {
    expect(maxPlanSharesForRisk('conservative')).toBe(800n);
    expect(maxPlanSharesForRisk('moderate')).toBe(1_500n);
    expect(maxPlanSharesForRisk('aggressive')).toBe(3_000n);
  });
});
