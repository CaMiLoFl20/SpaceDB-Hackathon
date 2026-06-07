export const GAME_DAY_OPEN_MINUTE = 9n * 60n + 30n;
export const GAME_DAY_CLOSE_MINUTE = 16n * 60n;
export const GAME_MINUTES_PER_DAY = GAME_DAY_CLOSE_MINUTE - GAME_DAY_OPEN_MINUTE;
export const REAL_MICROS_PER_GAME_HOUR = 30_000_000n;
export const REAL_MICROS_PER_GAME_MINUTE = REAL_MICROS_PER_GAME_HOUR / 60n;
export const OPEN_SESSION_MICROS =
  GAME_MINUTES_PER_DAY * REAL_MICROS_PER_GAME_MINUTE;
export const WARNING_MICROS = 30_000_000n;
export const FREEZE_MICROS = 10_000_000n;
export const RESULTS_MICROS = 15_000_000n;
export const PREDICTION_DEADLINE_MINUTE = 10n * 60n + 30n;

export type GameDayPhase = 'open' | 'closing_warning' | 'frozen' | 'results';

export type GameClockState = {
  phase: GameDayPhase;
  currentGameMinute: bigint;
  secondsUntilClose: bigint;
  secondsUntilNextDay: bigint;
  tradesAllowed: boolean;
  predictionsAllowed: boolean;
};

export function deriveGameClockState(
  openedAtMicros: bigint,
  nowMicros: bigint
): GameClockState {
  const elapsed = nowMicros > openedAtMicros ? nowMicros - openedAtMicros : 0n;
  if (elapsed >= OPEN_SESSION_MICROS) {
    const postCloseElapsed = elapsed - OPEN_SESSION_MICROS;
    const totalPostCloseMicros = FREEZE_MICROS + RESULTS_MICROS;
    const secondsUntilNextDay =
      postCloseElapsed >= totalPostCloseMicros
        ? 0n
        : (totalPostCloseMicros - postCloseElapsed + 999_999n) / 1_000_000n;

    const phase: GameDayPhase =
      postCloseElapsed < FREEZE_MICROS ? 'frozen' : 'results';

    return {
      phase,
      currentGameMinute: GAME_DAY_CLOSE_MINUTE,
      secondsUntilClose: 0n,
      secondsUntilNextDay,
      tradesAllowed: false,
      predictionsAllowed: false,
    };
  }

  const currentGameMinute =
    GAME_DAY_OPEN_MINUTE + elapsed / REAL_MICROS_PER_GAME_MINUTE;
  const secondsUntilClose = (OPEN_SESSION_MICROS - elapsed + 999_999n) / 1_000_000n;
  const phase =
    OPEN_SESSION_MICROS - elapsed <= WARNING_MICROS ? 'closing_warning' : 'open';

  return {
    phase,
    currentGameMinute,
    secondsUntilClose,
    secondsUntilNextDay: secondsUntilClose + FREEZE_MICROS / 1_000_000n,
    tradesAllowed: true,
    predictionsAllowed: currentGameMinute < PREDICTION_DEADLINE_MINUTE,
  };
}

export function formatGameMinute(minute: bigint): string {
  const hour24 = minute / 60n;
  const mins = minute % 60n;
  const suffix = hour24 >= 12n ? 'PM' : 'AM';
  const hour12Raw = hour24 % 12n;
  const hour12 = hour12Raw === 0n ? 12n : hour12Raw;
  return `${hour12.toString()}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

export function shouldRollToNextDay(openedAtMicros: bigint, nowMicros: bigint): boolean {
  const elapsed = nowMicros > openedAtMicros ? nowMicros - openedAtMicros : 0n;
  return elapsed >= OPEN_SESSION_MICROS + FREEZE_MICROS + RESULTS_MICROS;
}
