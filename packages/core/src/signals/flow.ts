import { formatAmount, formatTimestamp } from '../util/units.js';
import { recency, saturate } from '../util/stats.js';
import type { Evidence, Transfer } from '../types.js';
import { addressRef, makeEvidence, pairs, txRef, type Signal, type SignalContext } from './context.js';

const YEAR = 365 * 24 * 3600;

/**
 * The plainest link there is: value moved from one input address to the other.
 *
 * Strength rises with how many times it happened and how recently, and falls when the only contact
 * is a single dust-sized transfer, which is a well known way to poison clustering heuristics.
 */
export const directTransfer: Signal = {
  id: 'direct-transfer',
  category: 'flow',
  weight: 0.75,
  title: 'Direct transfer',
  description:
    'One input address sent value to the other. Repeated or bidirectional transfers are much stronger than a single one, because a single inbound transfer can be sent by anyone: address-poisoning campaigns dust thousands of wallets precisely to manufacture this edge. Dust-only contact is therefore discounted heavily, and a transfer the recipient never acted on is not treated as proof of shared control.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.chain !== right.ref.chain) continue;
      const forward = left.payees.get(right.ref.normalized) ?? [];
      const backward = right.payees.get(left.ref.normalized) ?? [];
      const all = [...forward, ...backward].filter((t) => t.success);
      if (all.length === 0) continue;

      const bidirectional = forward.length > 0 && backward.length > 0;
      const largest = all.reduce((best, t) => (t.value > best.value ? t : best), all[0] as Transfer);
      const latest = all.reduce((best, t) => (t.ts > best.ts ? t : best), all[0] as Transfer);
      const meaningful = all.filter((t) => t.value > 0);
      const dustOnly = meaningful.length > 0 && largest.value < 0.0005 && largest.asset.kind === 'native';

      let strength = 0.55 + 0.3 * saturate(all.length, 3);
      if (bidirectional) strength += 0.2;
      if (dustOnly) strength = Math.min(strength, 0.25);
      if (meaningful.length === 0) strength = Math.min(strength, 0.3);
      strength *= recency(latest.ts, ctx.now, 2 * YEAR, 0.6);

      out.push(
        makeEvidence({
          signal: directTransfer,
          a: left.key,
          b: right.key,
          strength,
          title: bidirectional ? 'Value moved in both directions' : 'Value moved between the addresses',
          detail: bidirectional
            ? `${forward.length} transfer(s) out and ${backward.length} back. Two-way flow is hard to explain without shared control or a standing relationship.`
            : `${all.length} transfer(s) from ${
                forward.length > 0 ? left.ref.address : right.ref.address
              }. ${dustOnly ? 'Every transfer is dust sized, which is consistent with address poisoning rather than ownership.' : ''}`.trim(),
          observations: [
            { label: 'Transfers', value: String(all.length) },
            {
              label: 'Largest',
              value: formatAmount(largest.value, largest.asset.symbol ?? largest.asset.kind),
            },
            { label: 'Most recent', value: formatTimestamp(latest.ts) },
            { label: 'Direction', value: bidirectional ? 'bidirectional' : 'one way' },
          ],
          references: all.slice(0, 5).map((t, i) => txRef(t, `Transfer ${i + 1}`)),
          lastSeen: latest.ts,
        }),
      );
    }
    return out;
  },
};

/**
 * Both addresses pay into the same non-service account.
 *
 * The high-value version of this is a shared exchange deposit address: deposit addresses are issued
 * per account, so two wallets funding the same one are almost always the same customer.
 */
export const commonPayee: Signal = {
  id: 'common-payee',
  category: 'flow',
  weight: 0.5,
  title: 'Shared payout target',
  description:
    'Both addresses send value to the same account, and that account is not a known exchange, bridge, router or contract. Consolidating into one destination is what a single operator does at the end of a run. The evidence is upgraded when the shared destination itself forwards into a labelled exchange, because that pattern identifies a per-customer deposit address rather than a coincidence.',
  run(ctx: SignalContext): Evidence[] {
    return sharedCounterpartyEvidence(ctx, 'payees', commonPayee, {
      title: 'Both fund the same destination',
      verb: 'sent value to',
    });
  },
};

export function sharedCounterpartyEvidence(
  ctx: SignalContext,
  side: 'payees' | 'funders',
  signal: Signal,
  copy: { title: string; verb: string },
): Evidence[] {
  const out: Evidence[] = [];
  const inputCount = ctx.index.size;
  for (const [left, right] of pairs(ctx)) {
    if (left.ref.chain !== right.ref.chain) continue;
    const chain = left.ref.chain;
    const leftMap = left[side];
    const rightMap = right[side];
    const shared: { address: string; left: Transfer[]; right: Transfer[] }[] = [];
    for (const [address, transfers] of leftMap) {
      const other = rightMap.get(address);
      if (!other) continue;
      if (address === left.ref.normalized || address === right.ref.normalized) continue;
      const key = `${chain}:${address}`;
      if (ctx.hubs.has(key) || ctx.labels.isHub(chain, address)) continue;
      if (ctx.context.get(key)?.facts.isContract) continue;
      shared.push({ address, left: transfers, right: other });
    }
    if (shared.length === 0) continue;

    for (const entry of shared.slice(0, 4)) {
      const holders = ctx.sharedBy.get(`${chain}:${entry.address}`)?.size ?? 2;
      const exclusivity = holders <= 2 ? 1 : Math.max(0.2, 1 - (holders - 2) / Math.max(2, inputCount - 2));
      const events = [...entry.left, ...entry.right];
      const latest = events.reduce((best, t) => (t.ts > best.ts ? t : best), events[0] as Transfer);
      const forwards = ctx.context.get(`${chain}:${entry.address}`)?.forwardsTo;
      const depositLike = Boolean(forwards);

      let strength = 0.5 * exclusivity + 0.25 * saturate(events.length, 4);
      if (depositLike) strength = Math.min(1, strength + 0.4);
      strength *= recency(latest.ts, ctx.now, 3 * YEAR, 0.65);

      out.push(
        makeEvidence({
          signal,
          a: left.key,
          b: right.key,
          strength,
          title: depositLike ? 'Both use the same deposit address' : copy.title,
          detail: depositLike
            ? `Both addresses ${copy.verb} ${entry.address}, which forwards into ${forwards?.name}. Exchange deposit addresses are issued per customer account, so two wallets feeding one are usually the same account holder.`
            : `Both addresses ${copy.verb} ${entry.address}, which is not a known service, contract or hub. ${holders > 2 ? `${holders} of the analysed addresses touch it, which weakens the inference.` : 'No other analysed address touches it.'}`,
          observations: [
            { label: 'Shared account', value: entry.address },
            { label: 'Events', value: `${entry.left.length} + ${entry.right.length}` },
            { label: 'Touched by', value: `${holders} of ${inputCount} inputs` },
            ...(forwards ? [{ label: 'Forwards into', value: forwards.name }] : []),
          ],
          references: [
            addressRef(chain, entry.address, 'Shared account'),
            ...events.slice(0, 4).map((t, i) => txRef(t, `Event ${i + 1}`)),
          ],
          lastSeen: latest.ts,
        }),
      );
    }
  }
  return out;
}
