/** A tiny argument parser. Braid's CLI surface is small enough that a dependency would be noise. */
export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const VALUE_FLAGS = new Set([
  'chains',
  'depth',
  'lookback',
  'min-score',
  'cluster-at',
  'signals',
  'budget',
  'csv',
  'out',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let command = '';

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=', 2);
      const key = name as string;
      if (inline !== undefined) {
        flags.set(key, inline);
      } else if (VALUE_FLAGS.has(key)) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) throw new Error(`--${key} needs a value`);
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      for (const letter of token.slice(1)) {
        if (letter === 'v') flags.set('verbose', true);
        else if (letter === 'h') flags.set('help', true);
        else if (letter === 'q') flags.set('quiet', true);
        else throw new Error(`unknown flag -${letter}`);
      }
      continue;
    }
    if (!command) command = token;
    else positionals.push(token);
  }

  return { command, positionals, flags };
}

export function flagNumber(flags: Map<string, string | boolean>, name: string): number | undefined {
  const value = flags.get(name);
  if (value === undefined || typeof value === 'boolean') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got "${value}"`);
  return parsed;
}

export function flagList(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const value = flags.get(name);
  if (value === undefined || typeof value === 'boolean') return undefined;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function flagString(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}
