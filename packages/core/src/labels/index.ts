import { readFileSync } from 'node:fs';
import builtin from './known-entities.json' with { type: 'json' };
import type { EntityKind, EntityLabel } from '../types.js';

interface RawEntry {
  chain: string;
  address: string;
  name: string;
  kind: string;
  hub?: boolean;
  stable?: string;
  decimals?: number;
}

interface LabelFile {
  version?: string;
  entries: RawEntry[];
}

const KINDS = new Set<EntityKind>([
  'exchange',
  'bridge',
  'router',
  'mixer',
  'staking',
  'infrastructure',
  'token',
  'burn',
  'program',
]);

function normalize(chain: string, address: string): string {
  return chain === 'solana' ? address : address.toLowerCase();
}

export interface StableAsset {
  symbol: string;
  chain: string;
  address: string;
  decimals: number;
}

export class LabelRegistry {
  private byKey = new Map<string, EntityLabel>();
  private wildcard = new Map<string, EntityLabel>();
  private stables: StableAsset[] = [];

  constructor(files: { file: LabelFile; source: string }[]) {
    for (const { file, source } of files) {
      for (const entry of file.entries ?? []) {
        const kind = (KINDS.has(entry.kind as EntityKind) ? entry.kind : 'infrastructure') as EntityKind;
        const label: EntityLabel = {
          name: entry.name,
          kind,
          hub: entry.hub ?? kind !== 'token',
          source,
        };
        const address = normalize(entry.chain, entry.address);
        if (entry.chain === '*') this.wildcard.set(address, label);
        else this.byKey.set(`${entry.chain}:${address}`, label);
        if (entry.stable) {
          this.stables.push({
            symbol: entry.stable,
            chain: entry.chain,
            address,
            decimals: entry.decimals ?? 6,
          });
        }
      }
    }
  }

  lookup(chain: string, address: string): EntityLabel | undefined {
    const normalized = normalize(chain, address);
    return this.byKey.get(`${chain}:${normalized}`) ?? this.wildcard.get(normalized);
  }

  /** True when co-occurrence with this address carries no ownership information. */
  isHub(chain: string, address: string): boolean {
    return this.lookup(chain, address)?.hub === true;
  }

  /** Stablecoin identity for a contract or mint, used by the cross-chain signal. */
  stable(chain: string, address: string): StableAsset | undefined {
    const normalized = normalize(chain, address);
    return this.stables.find((s) => s.address === normalized && (s.chain === chain || s.chain === '*'));
  }

  get size(): number {
    return this.byKey.size + this.wildcard.size;
  }
}

let cachedRegistry: LabelRegistry | undefined;

/**
 * The process-wide label registry.
 *
 * Built-in entries always load. `BRAID_LABELS_FILE` may point at a JSON file with the same shape;
 * its entries are layered on top, so operators can add their own attribution without a rebuild.
 */
export function labels(): LabelRegistry {
  if (cachedRegistry) return cachedRegistry;
  const files: { file: LabelFile; source: string }[] = [
    { file: builtin as unknown as LabelFile, source: 'braid' },
  ];
  const override = process.env.BRAID_LABELS_FILE;
  if (override) {
    try {
      files.push({ file: JSON.parse(readFileSync(override, 'utf8')) as LabelFile, source: override });
    } catch (err) {
      throw new Error(`BRAID_LABELS_FILE could not be read: ${(err as Error).message}`, { cause: err });
    }
  }
  cachedRegistry = new LabelRegistry(files);
  return cachedRegistry;
}

/** Test hook: forget the memoized registry so a new `BRAID_LABELS_FILE` takes effect. */
export function resetLabels(): void {
  cachedRegistry = undefined;
}
