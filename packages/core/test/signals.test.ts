import { describe, expect, it } from 'vitest';
import { buildContext, runSignals } from '../src/signals/index.js';
import { DEFAULT_OPTIONS } from '../src/analyze.js';
import { scoreEdges } from '../src/score.js';
import type { AnalysisOptions } from '../src/types.js';
import { A, B, bundle, DAY, EXCHANGE, FUNDER, SHARED, solanaBundle, T0, transfer } from './fixtures.js';

const NOW = T0 + 10 * DAY;
const options: AnalysisOptions = { ...DEFAULT_OPTIONS, hubShareThreshold: 8 };

function run(bundles: Parameters<typeof buildContext>[0], enabled: string[] = []) {
  const ctx = buildContext(bundles, new Map(), options, NOW);
  return runSignals(ctx, enabled);
}

function signalsFired(bundles: Parameters<typeof buildContext>[0]): string[] {
  return [...new Set(run(bundles).evidence.map((item) => item.signal))].sort();
}

describe('direct-transfer', () => {
  it('fires on value moving between the analysed addresses', () => {
    const t = transfer({ from: A, to: B, ts: NOW - DAY });
    const { evidence } = run([bundle(A, [t]), bundle(B, [t])], ['direct-transfer']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.title).toContain('Value moved');
    expect(evidence[0]?.references[0]?.url).toContain('etherscan.io/tx/');
  });

  it('scores bidirectional flow above one-way flow', () => {
    const out = transfer({ from: A, to: B, ts: NOW - DAY });
    const back = transfer({ from: B, to: A, ts: NOW - DAY });
    const oneWay = run([bundle(A, [out]), bundle(B, [out])], ['direct-transfer']).evidence[0];
    const twoWay = run([bundle(A, [out, back]), bundle(B, [out, back])], ['direct-transfer']).evidence[0];
    expect(twoWay?.strength ?? 0).toBeGreaterThan(oneWay?.strength ?? 0);
  });

  it('discounts dust-only contact, because anyone can poison an address', () => {
    const dust = transfer({ from: A, to: B, value: 0.00001, rawValue: '10000000000000', ts: NOW - DAY });
    const real = transfer({ from: A, to: B, value: 4, ts: NOW - DAY });
    const dustEdge = run([bundle(A, [dust]), bundle(B, [dust])], ['direct-transfer']).evidence[0];
    const realEdge = run([bundle(A, [real]), bundle(B, [real])], ['direct-transfer']).evidence[0];
    expect(dustEdge?.strength ?? 1).toBeLessThan(0.3);
    expect(realEdge?.strength ?? 0).toBeGreaterThan(dustEdge?.strength ?? 1);
    expect(dustEdge?.detail).toContain('poisoning');
  });

  it('stays silent when the addresses never touched', () => {
    expect(run([bundle(A, []), bundle(B, [])], ['direct-transfer']).evidence).toHaveLength(0);
  });
});

describe('first funding', () => {
  const openA = transfer({ from: FUNDER, to: A, ts: T0, value: 2 });
  const openB = transfer({ from: FUNDER, to: B, ts: T0 + 600, value: 2 });

  it('links two addresses opened by the same account', () => {
    const { evidence } = run([bundle(A, [openA]), bundle(B, [openB])], ['common-first-funder']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.observations.find((o) => o.label === 'Shared funder')?.value).toBe(FUNDER.toLowerCase());
  });

  it('is withheld when the history did not reach the account opening', () => {
    const partial = bundle(B, [openB], { reachedGenesis: false, truncated: true });
    expect(run([bundle(A, [openA]), partial], ['common-first-funder']).evidence).toHaveLength(0);
  });

  it('ignores a shared funder that is a known exchange', () => {
    const exA = transfer({ from: EXCHANGE, to: A, ts: T0 });
    const exB = transfer({ from: EXCHANGE, to: B, ts: T0 + 60 });
    expect(run([bundle(A, [exA]), bundle(B, [exB])], ['common-first-funder']).evidence).toHaveLength(0);
  });

  it('fires when one address funded the other into existence', () => {
    const open = transfer({ from: A, to: B, ts: T0, value: 0.02 });
    const { evidence } = run([bundle(A, [open]), bundle(B, [open])], ['peer-first-funding']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.detail).toContain('gas top-up');
  });
});

describe('funding-burst', () => {
  it('fires on same funder, same minute, matching amounts', () => {
    const a = transfer({ from: FUNDER, to: A, ts: T0, value: 5 });
    const b = transfer({ from: FUNDER, to: B, ts: T0 + 120, value: 5.05 });
    const { evidence } = run([bundle(A, [a]), bundle(B, [b])], ['funding-burst']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.strength).toBeGreaterThan(0.85);
  });

  it('stays silent when the amounts are unrelated', () => {
    const a = transfer({ from: FUNDER, to: A, ts: T0, value: 5 });
    const b = transfer({ from: FUNDER, to: B, ts: T0 + 120, value: 500 });
    expect(run([bundle(A, [a]), bundle(B, [b])], ['funding-burst']).evidence).toHaveLength(0);
  });

  it('stays silent when the fundings are far apart', () => {
    const a = transfer({ from: FUNDER, to: A, ts: T0, value: 5 });
    const b = transfer({ from: FUNDER, to: B, ts: T0 + 30 * DAY, value: 5 });
    expect(run([bundle(A, [a]), bundle(B, [b])], ['funding-burst']).evidence).toHaveLength(0);
  });
});

describe('shared counterparties', () => {
  it('links two addresses paying the same unlabelled account', () => {
    const a = transfer({ from: A, to: SHARED, ts: NOW - DAY });
    const b = transfer({ from: B, to: SHARED, ts: NOW - DAY });
    const { evidence } = run([bundle(A, [a]), bundle(B, [b])], ['common-payee']);
    expect(evidence).toHaveLength(1);
  });

  it('ignores a shared counterparty that is a known router', () => {
    const router = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
    const a = transfer({ from: A, to: router, ts: NOW - DAY });
    const b = transfer({ from: B, to: router, ts: NOW - DAY });
    expect(run([bundle(A, [a]), bundle(B, [b])], ['common-payee']).evidence).toHaveLength(0);
  });

  it('needs more than one shared counterparty before the overlap signal fires', () => {
    const many = (self: string) =>
      ['0xaa', '0xbb', '0xcc', '0xdd'].map((suffix, i) =>
        transfer({ from: self, to: `0x${suffix.slice(2).repeat(20)}`.slice(0, 42), ts: NOW - i * DAY }),
      );
    const shared = many(A);
    const fired = run([bundle(A, shared), bundle(B, shared.map((t) => ({ ...t, from: B.toLowerCase() })))], [
      'counterparty-overlap',
    ]);
    expect(fired.evidence.length).toBeGreaterThan(0);
  });
});

describe('solana control signals', () => {
  const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const OTHER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const TOKEN_ACCOUNT = 'BwzWKw33iBQin9E8HwFgevCeMByioZCvoZFk7uN433ft';

  it('treats on-chain token account ownership as confirmed', () => {
    const child = solanaBundle(TOKEN_ACCOUNT, []);
    child.facts.solanaTokenAccount = { owner: WALLET, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
    const { evidence } = run([child, solanaBundle(WALLET, [])], ['solana-account-control']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.strength).toBe(1);
    const [edge] = scoreEdges(evidence, 0);
    expect(edge?.band).toBe('confirmed');
  });

  it('links accounts that share a transaction signer', () => {
    const payer = 'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN6';
    const left = solanaBundle(WALLET, []);
    const right = solanaBundle(OTHER, []);
    left.payers = [payer];
    right.payers = [payer];
    const { evidence } = run([left, right], ['solana-fee-payer']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.title).toContain('third account signs for both');
  });

  it('ignores a shared signer that is a labelled exchange', () => {
    const left = solanaBundle('DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', []);
    const right = solanaBundle('3Nw8ZjuUuF9dGKcCLFhvVzUKnZMy5tSAsMTVDXBrGZ8k', []);
    left.payers = [WALLET];
    right.payers = [WALLET];
    expect(run([left, right], ['solana-fee-payer']).evidence).toHaveLength(0);
  });
});

describe('behavioural signals', () => {
  it('never lets a behavioural signal alone reach the strong band', () => {
    const hours = Array.from({ length: 40 }, (_, i) =>
      transfer({ from: A, to: SHARED, ts: T0 + i * DAY + 9 * 3600 }),
    );
    const mirrored = hours.map((t) => ({ ...t, from: B.toLowerCase() }));
    const { evidence } = run([bundle(A, hours), bundle(B, mirrored)], ['temporal-profile']);
    const [edge] = scoreEdges(evidence, 0);
    expect(edge === undefined || edge.score < 65).toBe(true);
  });

  it('needs enough activity before profiling hours at all', () => {
    const few = [transfer({ from: A, to: SHARED, ts: T0 })];
    expect(run([bundle(A, few), bundle(B, [])], ['temporal-profile']).evidence).toHaveLength(0);
  });
});

describe('signal isolation', () => {
  it('runs every signal without throwing on empty input', () => {
    const { failures } = run([bundle(A, []), bundle(B, [])]);
    expect(failures).toEqual([]);
  });

  it('emits nothing for two addresses with no relationship at all', () => {
    const a = transfer({ from: A, to: '0x9999999999999999999999999999999999999999', ts: NOW });
    const b = transfer({ from: B, to: '0x8888888888888888888888888888888888888888', ts: NOW });
    expect(signalsFired([bundle(A, [a]), bundle(B, [b])])).toEqual([]);
  });
});
