/** Terminal styling. Honours NO_COLOR and degrades to plain text when the output is piped. */
const enabled = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

const ESC = String.fromCharCode(27);

const CODES = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  green: `${ESC}[32m`,
  cyan: `${ESC}[36m`,
  magenta: `${ESC}[35m`,
} as const;

export type Style = Exclude<keyof typeof CODES, 'reset'>;

export function paint(text: string, ...styles: Style[]): string {
  if (!enabled || styles.length === 0) return text;
  return `${styles.map((style) => CODES[style]).join('')}${text}${CODES.reset}`;
}

export function bandStyle(band: string): Style {
  switch (band) {
    case 'confirmed':
      return 'red';
    case 'strong':
      return 'magenta';
    case 'moderate':
      return 'yellow';
    default:
      return 'dim';
  }
}

/** A fixed-width score bar. Uses block characters so it lines up in any monospace font. */
export function bar(score: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return `${'\u2588'.repeat(filled)}${'\u2591'.repeat(width - filled)}`;
}
