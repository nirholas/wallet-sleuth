import { cosine, jaccard, relativeDelta } from '../util/stats.js';
import { formatAmount, formatTimestamp } from '../util/units.js';
import type { Evidence, Transfer } from '../types.js';
import { makeEvidence, pairs, txRef, type BundleIndex, type Signal, type SignalContext } from './context.js';

/**
 * When someone is awake shows up in their transaction times.
 *
 * On its own this proves nothing: half the world shares a timezone. It is deliberately weighted low
 * and exists to corroborate stronger evidence, never to create a link by itself.
 */
export const temporalProfile: Signal = {
  id: 'temporal-profile',
  category: 'behavioral',
  weight: 0.15,
  title: 'Matching activity hours',
  description:
    'Cosine similarity between the two addresses\' UTC hour-of-day activity histograms, computed only when both have enough activity to make a profile meaningful. A human operator leaves a daily rhythm; a bot leaves a flat one. This is the weakest signal Wallet Sleuth emits and cannot lift a pair past the weak band on its own.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      const leftTotal = left.hours.reduce((sum, n) => sum + n, 0);
      const rightTotal = right.hours.reduce((sum, n) => sum + n, 0);
      if (leftTotal < 12 || rightTotal < 12) continue;

      const a = left.hours.map((n) => n / leftTotal);
      const b = right.hours.map((n) => n / rightTotal);
      const similarity = cosine(a, b);
      const activeHours = a.filter((v) => v > 0.01).length;
      if (similarity < 0.85 || activeHours > 18) continue;

      const strength = Math.min(1, (similarity - 0.85) / 0.14) * (1 - activeHours / 24);
      if (strength <= 0.05) continue;

      out.push(
        makeEvidence({
          signal: temporalProfile,
          a: left.key,
          b: right.key,
          strength,
          title: 'Active in the same hours',
          detail: `Hour-of-day activity profiles match at ${(similarity * 100).toFixed(1)}% cosine similarity across a ${activeHours}-hour active window. Suggestive of one operator, and nothing more.`,
          observations: [
            { label: 'Profile similarity', value: `${(similarity * 100).toFixed(1)}%` },
            { label: 'Active hours (UTC)', value: `${activeHours}/24` },
            { label: 'Sample size', value: `${leftTotal} / ${rightTotal} events` },
          ],
        }),
      );
    }
    return out;
  },
};

/**
 * Two wallets holding the same unusual set of assets is a weak but real fingerprint.
 */
export const assetOverlap: Signal = {
  id: 'asset-overlap',
  category: 'behavioral',
  weight: 0.2,
  title: 'Same asset mix',
  description:
    'Jaccard similarity over the token contracts and mints each address has moved, ignoring the majors that nearly every wallet touches. Two wallets holding the same handful of obscure assets have made the same choices; that is suggestive, not conclusive, since airdrop farming and copy trading produce it too.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      const filter = (assets: Set<string>, chain: string) =>
        new Set([...assets].filter((asset) => !ctx.labels.lookup(chain, asset)));
      const a = filter(left.assets, left.ref.chain);
      const b = filter(right.assets, right.ref.chain);
      if (a.size < 2 || b.size < 2) continue;
      const similarity = jaccard(a, b);
      if (similarity < 0.25) continue;
      const shared = [...a].filter((asset) => b.has(asset));
      if (shared.length < 2) continue;

      out.push(
        makeEvidence({
          signal: assetOverlap,
          a: left.key,
          b: right.key,
          strength: Math.min(1, similarity / 0.7),
          title: `${shared.length} uncommon assets in common`,
          detail: `Both addresses have moved the same ${shared.length} token(s) outside the well known majors (Jaccard ${(similarity * 100).toFixed(0)}%).`,
          observations: [
            { label: 'Shared assets', value: String(shared.length) },
            { label: 'Similarity', value: `${(similarity * 100).toFixed(0)}%` },
            { label: 'Portfolio sizes', value: `${a.size} / ${b.size}` },
          ],
        }),
      );
    }
    return out;
  },
};

/**
 * Cross-chain stablecoin correlation.
 *
 * The one honest way to tie an EVM address to a Solana address without a bridge receipt: a
 * stablecoin amount leaves one and an equal amount arrives at the other, minutes later.
 */
export const crossChainStable: Signal = {
  id: 'cross-chain-stable',
  category: 'flow',
  weight: 0.5,
  title: 'Cross-chain value handoff',
  description:
    'A stablecoin amount left one address and a near identical amount arrived at the other on a different chain shortly afterwards. Because stablecoins carry the same unit of account on every chain, the amounts are directly comparable, which is what makes the correlation checkable rather than speculative. It is still correlation: a busy bridge route can produce a coincidental match, so the window is tight, round numbers are discounted, and matches only count when the amounts agree to within a fraction of a percent.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    const WINDOW = 45 * 60;

    const stableTransfers = (index: BundleIndex, direction: 'in' | 'out') => {
      const list = direction === 'in' ? index.inbound : index.outbound;
      return list.filter((transfer) => {
        if (!transfer.success || !transfer.asset.address) return false;
        const stable = ctx.labels.stable(transfer.chain, transfer.asset.address);
        return Boolean(stable) && transfer.value >= 50;
      });
    };

    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain === right.ref.chain) continue;

      let best: { out: Transfer; in: Transfer; gap: number; delta: number } | undefined;
      for (const [source, target] of [
        [left, right],
        [right, left],
      ] as const) {
        for (const sent of stableTransfers(source, 'out')) {
          for (const received of stableTransfers(target, 'in')) {
            const gap = received.ts - sent.ts;
            if (gap < 0 || gap > WINDOW) continue;
            const delta = relativeDelta(sent.value, received.value);
            if (delta > 0.02) continue;
            if (!best || delta < best.delta) best = { out: sent, in: received, gap, delta };
          }
        }
      }
      if (!best) continue;

      const roundNumber = Math.abs(best.out.value - Math.round(best.out.value)) < 0.001 && best.out.value % 100 === 0;
      const precision = 1 - Math.min(1, best.delta / 0.02);
      const timing = 1 - Math.min(1, best.gap / WINDOW);
      let strength = 0.35 + 0.4 * precision + 0.25 * timing;
      if (roundNumber) strength *= 0.7;

      out.push(
        makeEvidence({
          signal: crossChainStable,
          a: left.key,
          b: right.key,
          strength,
          title: 'Matching stablecoin amount across chains',
          detail: `${formatAmount(best.out.value)} left ${best.out.chain} and ${formatAmount(best.in.value)} arrived on ${best.in.chain} ${Math.round(best.gap / 60)} minutes later, a ${(best.delta * 100).toFixed(2)}% difference.${roundNumber ? ' The amount is a round number, which makes a coincidental match more likely, so the score is discounted.' : ''}`,
          observations: [
            { label: 'Sent', value: `${formatAmount(best.out.value)} on ${best.out.chain}` },
            { label: 'Received', value: `${formatAmount(best.in.value)} on ${best.in.chain}` },
            { label: 'Delay', value: `${Math.round(best.gap / 60)} minutes` },
            { label: 'Amount difference', value: `${(best.delta * 100).toFixed(2)}%` },
            { label: 'When', value: formatTimestamp(best.out.ts) },
          ],
          references: [txRef(best.out, 'Outbound leg'), txRef(best.in, 'Inbound leg')],
          lastSeen: best.in.ts,
        }),
      );
    }
    return out;
  },
};
