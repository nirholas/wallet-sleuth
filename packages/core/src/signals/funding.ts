import { formatAmount, formatTimestamp } from '../util/units.js';
import { recency, relativeDelta, saturate } from '../util/stats.js';
import type { Evidence, Transfer } from '../types.js';
import { sharedCounterpartyEvidence } from './flow.js';
import { addressRef, makeEvidence, pairs, txRef, type Signal, type SignalContext } from './context.js';

const YEAR = 365 * 24 * 3600;

/**
 * One address paid for the other's first breath.
 *
 * An account's opening balance has to come from somewhere, and whoever sent it either owns the new
 * account or knowingly created it. This is the strongest ordinary-flow signal in the set.
 */
export const peerFunding: Signal = {
  id: 'peer-first-funding',
  category: 'funding',
  weight: 0.9,
  title: 'Opening balance came from the peer',
  description:
    'The earliest inbound value one address ever received came from the other analysed address. A wallet cannot transact before it is funded, so the funder is either the same operator bootstrapping a new address or a party that deliberately created it. The signal is only emitted when the funding transfer is genuinely the earliest in the collected sample; if history was truncated before the account opened, it is withheld rather than guessed.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain !== right.ref.chain) continue;
      for (const [funder, funded] of [
        [left, right],
        [right, left],
      ] as const) {
        const opening = funded.firstFunding;
        if (!opening || opening.address !== funder.ref.normalized) continue;
        if (!funded.bundle.reachedGenesis) continue;

        const gasSized = opening.transfer.asset.kind === 'native' && opening.transfer.value < 0.05;
        const strength =
          (gasSized ? 0.95 : 0.85) * recency(opening.transfer.ts, ctx.now, 4 * YEAR, 0.75);

        out.push(
          makeEvidence({
            signal: peerFunding,
            a: funder.key,
            b: funded.key,
            strength,
            title: 'First funding came from the other address',
            detail: `${funded.ref.address} received its earliest observed value from ${funder.ref.address}${
              gasSized ? ', in an amount consistent with a gas top-up used to activate a fresh wallet' : ''
            }.`,
            observations: [
              { label: 'Funded address', value: funded.ref.address },
              { label: 'Funder', value: funder.ref.address },
              {
                label: 'Amount',
                value: formatAmount(opening.transfer.value, opening.transfer.asset.symbol ?? ''),
              },
              { label: 'When', value: formatTimestamp(opening.transfer.ts) },
            ],
            references: [txRef(opening.transfer, 'Funding transaction')],
            lastSeen: opening.transfer.ts,
          }),
        );
      }
    }
    return out;
  },
};

/**
 * Two addresses were opened by the same account.
 *
 * A shared first funder is far more discriminating than a shared funder anywhere later in the
 * history, because it is a decision made once, at the moment the address came into existence.
 */
export const commonFirstFunder: Signal = {
  id: 'common-first-funder',
  category: 'funding',
  weight: 0.8,
  title: 'Same account opened both',
  description:
    'The first inbound value both addresses ever received came from the same account, and that account is not a labelled exchange, bridge or contract. Whoever funds a wallet into existence usually controls it. Strength drops when the shared funder also opened many other analysed addresses, since a payroll or airdrop contract fits that shape too, and when the two openings are far apart in time.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    const inputCount = ctx.index.size;
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain !== right.ref.chain) continue;
      if (!left.bundle.reachedGenesis || !right.bundle.reachedGenesis) continue;
      const a = left.firstFunding;
      const b = right.firstFunding;
      if (!a || !b || a.address !== b.address) continue;
      const chain = left.ref.chain;
      const funder = a.address;
      if (funder === left.ref.normalized || funder === right.ref.normalized) continue;
      const key = `${chain}:${funder}`;
      if (ctx.hubs.has(key) || ctx.labels.isHub(chain, funder)) continue;
      if (ctx.context.get(key)?.facts.isContract) continue;

      const holders = ctx.sharedBy.get(key)?.size ?? 2;
      const exclusivity = holders <= 2 ? 1 : Math.max(0.25, 1 - (holders - 2) / Math.max(2, inputCount - 2));
      const gap = Math.abs(a.transfer.ts - b.transfer.ts);
      const proximity = gap <= 3600 ? 1 : gap <= 86_400 ? 0.85 : gap <= 30 * 86_400 ? 0.65 : 0.45;
      const amountMatch = 1 - Math.min(1, relativeDelta(a.transfer.value, b.transfer.value));
      const strength = Math.min(1, (0.55 + 0.25 * proximity + 0.2 * amountMatch) * exclusivity);

      out.push(
        makeEvidence({
          signal: commonFirstFunder,
          a: left.key,
          b: right.key,
          strength,
          title: 'Both addresses were opened by the same account',
          detail: `${funder} sent the first value both addresses ever received, ${
            gap < 3600
              ? `within ${Math.round(gap / 60)} minutes of each other`
              : `${Math.round(gap / 86_400)} days apart`
          }.`,
          observations: [
            { label: 'Shared funder', value: funder },
            { label: 'Gap between openings', value: humanGap(gap) },
            { label: 'Amounts', value: `${formatAmount(a.transfer.value)} / ${formatAmount(b.transfer.value)}` },
            { label: 'Opened by it', value: `${holders} of ${inputCount} inputs` },
          ],
          references: [
            addressRef(chain, funder, 'Funder'),
            txRef(a.transfer, 'Opening of A'),
            txRef(b.transfer, 'Opening of B'),
          ],
          lastSeen: Math.max(a.transfer.ts, b.transfer.ts),
        }),
      );
    }
    return out;
  },
};

/** Any shared funder, not just the first one. */
export const commonFunder: Signal = {
  id: 'common-funder',
  category: 'funding',
  weight: 0.55,
  title: 'Shared funding source',
  description:
    'The same non-service account sent value to both addresses at some point. Weaker than a shared first funder because a treasury, a friend or a small project can pay many unrelated wallets, so the score is scaled down by how many of the analysed addresses that funder touches and by how long ago it happened.',
  run(ctx: SignalContext): Evidence[] {
    return sharedCounterpartyEvidence(ctx, 'funders', commonFunder, {
      title: 'Funded by the same account',
      verb: 'received value from',
    });
  },
};

/**
 * Same funder, near-simultaneous, near-identical amounts.
 *
 * This is the fingerprint of a batch: one operator spreading a balance across fresh addresses in
 * a single sitting, which is exactly what someone splitting funds to avoid clustering does.
 */
export const fundingBurst: Signal = {
  id: 'funding-burst',
  category: 'funding',
  weight: 0.6,
  title: 'Funded in the same batch',
  description:
    'Both addresses received value from the same account within a short window, in similar amounts. Batch funding is a deliberate act by one operator; unrelated wallets funded by a shared source rarely match on timing and size at once. Airdrops and payroll runs produce the same shape, so this signal is scored as corroboration rather than proof.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain !== right.ref.chain) continue;
      const chain = left.ref.chain;
      let best: { funder: string; a: Transfer; b: Transfer; gap: number; delta: number } | undefined;

      for (const [funder, aTransfers] of left.funders) {
        const bTransfers = right.funders.get(funder);
        if (!bTransfers) continue;
        const key = `${chain}:${funder}`;
        if (ctx.hubs.has(key) || ctx.labels.isHub(chain, funder)) continue;
        for (const a of aTransfers) {
          for (const b of bTransfers) {
            const gap = Math.abs(a.ts - b.ts);
            if (gap > 3600) continue;
            const delta = relativeDelta(a.value, b.value);
            if (delta > 0.25) continue;
            if (!best || gap < best.gap) best = { funder, a, b, gap, delta };
          }
        }
      }
      if (!best) continue;

      const timing = 1 - Math.min(1, best.gap / 3600);
      const sizing = 1 - Math.min(1, best.delta / 0.25);
      const strength = 0.45 + 0.3 * timing + 0.25 * sizing;

      out.push(
        makeEvidence({
          signal: fundingBurst,
          a: left.key,
          b: right.key,
          strength,
          title: 'Funded together, in matching amounts',
          detail: `${best.funder} funded both addresses ${humanGap(best.gap)} apart with amounts within ${(best.delta * 100).toFixed(1)}% of each other.`,
          observations: [
            { label: 'Funder', value: best.funder },
            { label: 'Time apart', value: humanGap(best.gap) },
            { label: 'Amounts', value: `${formatAmount(best.a.value)} / ${formatAmount(best.b.value)}` },
          ],
          references: [txRef(best.a, 'Funding of A'), txRef(best.b, 'Funding of B')],
          lastSeen: Math.max(best.a.ts, best.b.ts),
        }),
      );
    }
    return out;
  },
};

/**
 * Overlap across the whole counterparty set.
 *
 * Any one shared counterparty can be coincidence. A large overlap of the *non-hub* counterparty
 * sets is a behavioural fingerprint: two wallets moving in the same small social and contractual
 * neighbourhood.
 */
export const counterpartyOverlap: Signal = {
  id: 'counterparty-overlap',
  category: 'coactivity',
  weight: 0.4,
  title: 'Overlapping counterparty set',
  description:
    'The two addresses interact with a similar set of accounts once exchanges, bridges, routers, contracts and other hubs are removed. Measured as Jaccard similarity over the remaining counterparties, so a wallet with thousands of contacts does not inflate the score by breadth alone. This is circumstantial: people in the same community share counterparties without sharing keys.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain !== right.ref.chain) continue;
      const chain = left.ref.chain;
      const filter = (set: Set<string>) =>
        new Set(
          [...set].filter((address) => {
            const key = `${chain}:${address}`;
            if (ctx.hubs.has(key) || ctx.labels.isHub(chain, address)) return false;
            if (ctx.context.get(key)?.facts.isContract) return false;
            return address !== left.ref.normalized && address !== right.ref.normalized;
          }),
        );
      const a = filter(left.counterparties);
      const b = filter(right.counterparties);
      if (a.size < 3 || b.size < 3) continue;
      const overlap = [...a].filter((address) => b.has(address));
      if (overlap.length < 2) continue;
      const similarity = overlap.length / (a.size + b.size - overlap.length);
      if (similarity < 0.08) continue;

      const strength = Math.min(1, 0.35 * saturate(overlap.length, 4) + 0.65 * Math.min(1, similarity / 0.5));

      out.push(
        makeEvidence({
          signal: counterpartyOverlap,
          a: left.key,
          b: right.key,
          strength,
          title: `${overlap.length} counterparties in common`,
          detail: `After removing exchanges, bridges, routers and contracts, ${overlap.length} accounts appear in both histories (Jaccard ${(similarity * 100).toFixed(1)}%).`,
          observations: [
            { label: 'Shared counterparties', value: String(overlap.length) },
            { label: 'Similarity', value: `${(similarity * 100).toFixed(1)}%` },
            { label: 'Set sizes', value: `${a.size} / ${b.size}` },
          ],
          references: overlap.slice(0, 6).map((address, i) => addressRef(chain, address, `Shared ${i + 1}`)),
        }),
      );
    }
    return out;
  },
};

function humanGap(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
