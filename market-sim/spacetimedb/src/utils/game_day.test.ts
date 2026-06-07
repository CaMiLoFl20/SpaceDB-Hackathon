import { describe, expect, it } from 'vitest';
import {
  FREEZE_MICROS,
  RESULTS_MICROS,
  GAME_DAY_CLOSE_MINUTE,
  GAME_DAY_OPEN_MINUTE,
  OPEN_SESSION_MICROS,
  deriveGameClockState,
  formatGameMinute,
  shouldRollToNextDay,
} from './game_day';

describe('game day clock', () => {
  it('starts at market open and allows predictions', () => {
    const state = deriveGameClockState(1_000n, 1_000n);
    expect(state.phase).toBe('open');
    expect(state.currentGameMinute).toBe(GAME_DAY_OPEN_MINUTE);
    expect(state.tradesAllowed).toBe(true);
    expect(state.predictionsAllowed).toBe(true);
  });

  it('enters frozen phase after close', () => {
    const state = deriveGameClockState(0n, OPEN_SESSION_MICROS);
    expect(state.phase).toBe('frozen');
    expect(state.currentGameMinute).toBe(GAME_DAY_CLOSE_MINUTE);
    expect(state.tradesAllowed).toBe(false);
  });

  it('enters results phase after freeze', () => {
    const state = deriveGameClockState(0n, OPEN_SESSION_MICROS + FREEZE_MICROS);
    expect(state.phase).toBe('results');
    expect(state.tradesAllowed).toBe(false);
    expect(state.secondsUntilNextDay).toBeGreaterThan(0n);
  });

  it('rolls after open session plus freeze plus results', () => {
    expect(shouldRollToNextDay(0n, OPEN_SESSION_MICROS + FREEZE_MICROS + RESULTS_MICROS)).toBe(true);
    expect(shouldRollToNextDay(0n, OPEN_SESSION_MICROS + FREEZE_MICROS)).toBe(false);
  });

  it('formats game minutes', () => {
    expect(formatGameMinute(570n)).toBe('9:30 AM');
    expect(formatGameMinute(960n)).toBe('4:00 PM');
  });
});
