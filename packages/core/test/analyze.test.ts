import { describe, expect, it } from 'vitest';
import { analyze, resolveOptions } from '../src/analyze.js';
import { InvalidInputError } from '../src/errors.js';
import { NullCache } from '../src/util/cache.js';
import type { ChainProvider, ProviderActivity } from '../src/providers/types.js';
import type { AccountFacts, AddressRef, Transfer } from '../src/types.js';
import { A, B, FUNDER, T0, transfer } from './fixtures.js';

/**
 * A provider stub that replays a fixed transfer set.
 *
 * The point of these tests is the pipeline, not the network: they check that collection, hub
 * resolution, signals, scoring and clustering compose correctly, and that a provider failure
 * degrades into a warning instead of a crash. Real provider behaviour is covered in `test/live`.
 */
class StubProvider implements ChainProvider {
  readonly name = 'stub';
  readonly namespace = 'evm' as const;
  readonly priority = 1000;

  constructor(
    private readonly byAddress: Record<string, Transfer[]>,
    private readonly facts: Record<string, Partial<AccountFacts>> = {},
    private readonly failOn: string[] = [],
  ) {}

  supports(): boolean {
    return true;
  }

  async fetchActivity(ref: AddressRef): Promise<ProviderActivity> {
    if (this.failOn.includes(ref.normalized)) throw new Error('upstream exploded');
    // The stub only holds Ethereum history, which is what lets the fan-out test observe an empty
    // chain guess being dropped.
    return {
      transfers: ref.chain === 'ethereum' ? (this.byAddress[ref.normalized] ?? []) : [],
      payers: [],
      truncated: false,
      reachedGenesis: true,
      warnings: [],
    };
  }

  async fetchFacts(ref: AddressRef): Promise<Partial<AccountFacts>> {
    return this.facts[ref.normalized] ?? {};
  }
}

const deps = (provider: ChainProvider) => ({ providers: [provider], cache: new NullCache(), now: T0 + 86_400 });

describe('option resolution', () => {
  it('clamps out-of-range values instead of trusting them', () => {
    const options = resolveOptions({ maxTransfersPerAddress: 10_000_000, minScore: -5, budgetMs: 1 });
    expect(options.maxTransfersPerAddress).toBe(5000);
    expect(options.minScore).toBe(0);
    expect(options.budgetMs).toBe(5000);
  });

  it('rejects an unknown signal id with the list of known ones', () => {
    expect(() => resolveOptions({ signals: ['not-a-signal'] })).toThrow(InvalidInputError);
  });
});

describe('analyze', () => {
  const opening = transfer({ from: FUNDER, to: A, ts: T0, value: 3 });
  const openingB = transfer({ from: FUNDER, to: B, ts: T0 + 300, value: 3 });
  const between = transfer({ from: A, to: B, ts: T0 + 5000, value: 1.5 });

  it('produces a scored, clustered report from real pipeline stages', async () => {
    const provider = new StubProvider({
      [A.toLowerCase()]: [opening, between],
      [B.toLowerCase()]: [openingB, between],
    });
    const report = await analyze(
      { addresses: [A, B], chains: ['ethereum'], options: { enrichCounterparties: false } },
      deps(provider),
    );

    expect(report.accounts).toHaveLength(2);
    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]?.score).toBeGreaterThan(80);
    expect(report.edges[0]?.signals).toContain('direct-transfer');
    expect(report.edges[0]?.signals).toContain('common-first-funder');
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0]?.members).toHaveLength(2);
    expect(report.accounts.every((account) => account.cluster === 'cluster-1')).toBe(true);
    expect(report.summary.transfersAnalyzed).toBe(4);
  });

  it('reports an honest empty result rather than inventing a link', async () => {
    const provider = new StubProvider({
      [A.toLowerCase()]: [transfer({ from: A, to: '0x9999999999999999999999999999999999999999', ts: T0 })],
      [B.toLowerCase()]: [transfer({ from: B, to: '0x8888888888888888888888888888888888888888', ts: T0 })],
    });
    const report = await analyze({ addresses: [A, B], chains: ['ethereum'] }, deps(provider));
    expect(report.edges).toHaveLength(0);
    expect(report.clusters).toHaveLength(0);
    expect(report.summary.strongestScore).toBe(0);
  });

  it('keeps going when a provider fails, and says so on the affected account', async () => {
    const provider = new StubProvider(
      { [A.toLowerCase()]: [opening] },
      {},
      [B.toLowerCase()],
    );
    const report = await analyze({ addresses: [A, B], chains: ['ethereum'] }, deps(provider));
    expect(report.accounts).toHaveLength(2);
    const failed = report.accounts.find((account) => account.address.toLowerCase() === B.toLowerCase());
    expect(failed?.warnings.join(' ')).toContain('upstream exploded');
  });

  it('warns when an input address is a known service', async () => {
    const exchange = '0x28c6c06298d514db089934071355e5743bf21d60';
    const provider = new StubProvider({ [A.toLowerCase()]: [], [exchange]: [] });
    const report = await analyze({ addresses: [A, exchange], chains: ['ethereum'] }, deps(provider));
    expect(report.warnings.join(' ')).toContain('known service');
  });

  it('rejects unusable input with the reasons attached', async () => {
    const provider = new StubProvider({});
    await expect(analyze({ addresses: ['nonsense', 'also nonsense'] }, deps(provider))).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('surfaces rejected entries alongside a valid analysis', async () => {
    const provider = new StubProvider({ [A.toLowerCase()]: [opening], [B.toLowerCase()]: [openingB] });
    const report = await analyze({ addresses: [A, B, 'garbage'], chains: ['ethereum'] }, deps(provider));
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]?.input).toBe('garbage');
  });

  it('drops inferred chains that turned out to be empty', async () => {
    const provider = new StubProvider({ [A.toLowerCase()]: [opening], [B.toLowerCase()]: [openingB] });
    const report = await analyze({ addresses: [A, B] }, deps(provider));
    expect(report.accounts.every((account) => account.chain === 'ethereum')).toBe(true);
    expect(report.warnings.join(' ')).toContain('dropped');
  });

  it('honours a restricted signal list', async () => {
    const provider = new StubProvider({
      [A.toLowerCase()]: [opening, between],
      [B.toLowerCase()]: [openingB, between],
    });
    const report = await analyze(
      { addresses: [A, B], chains: ['ethereum'], options: { signals: ['direct-transfer'], enrichCounterparties: false } },
      deps(provider),
    );
    expect(report.edges[0]?.signals).toEqual(['direct-transfer']);
  });

  it('reports provider statistics and a stable report shape', async () => {
    const provider = new StubProvider({ [A.toLowerCase()]: [opening], [B.toLowerCase()]: [openingB] });
    const report = await analyze({ addresses: [A, B], chains: ['ethereum'] }, deps(provider));
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.version).toBe('1.0.0');
    expect(new Date(report.createdAt).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(report.providers)).toBe(true);
  });

  it('emits progress for every phase', async () => {
    const provider = new StubProvider({ [A.toLowerCase()]: [opening], [B.toLowerCase()]: [openingB] });
    const phases: string[] = [];
    await analyze(
      { addresses: [A, B], chains: ['ethereum'] },
      { ...deps(provider), onProgress: (event) => phases.push(event.phase) },
    );
    expect(new Set(phases)).toContain('collect');
    expect(new Set(phases)).toContain('signals');
    expect(new Set(phases)).toContain('score');
  });
});
