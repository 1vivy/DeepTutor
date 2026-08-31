const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 200;

export function shouldStopReconnecting({
  attempt,
  activeTurnId,
}: {
  attempt: number;
  activeTurnId: string | null;
}): boolean {
  return !activeTurnId && attempt >= MAX_RECONNECT_ATTEMPTS;
}

export function reconnectDelayMs(attempt: number): number {
  const cappedAttempt = Math.min(
    Math.max(0, attempt),
    MAX_RECONNECT_ATTEMPTS - 1,
  );
  return BASE_RECONNECT_DELAY_MS * Math.pow(2, cappedAttempt);
}
