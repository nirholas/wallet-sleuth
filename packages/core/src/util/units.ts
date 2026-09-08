/** Converts a base-unit integer string to human units without losing precision on the way in. */
export function fromBaseUnits(raw: string, decimals: number): number {
  if (!raw) return 0;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/[^0-9]/g, '');
  if (!digits) return 0;
  if (decimals <= 0) return Number(digits) * (negative ? -1 : 1);
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  const value = Number(`${whole}.${fraction}`);
  return negative ? -value : value;
}

/** Compact human formatting for amounts of wildly different magnitude. */
export function formatAmount(value: number, symbol?: string): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs === 0) text = '0';
  else if (abs < 0.0001) text = value.toExponential(2);
  else if (abs < 1) text = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  else if (abs < 1000) text = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  else text = value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return symbol ? `${text} ${symbol}` : text;
}

export function formatTimestamp(ts: number): string {
  if (!ts) return 'unknown';
  return new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
}
