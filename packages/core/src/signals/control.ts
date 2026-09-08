import { formatTimestamp } from '../util/units.js';
import { saturate } from '../util/stats.js';
import type { Evidence, Transfer } from '../types.js';
import { addressRef, makeEvidence, pairs, txRef, type Signal, type SignalContext } from './context.js';

/**
 * On Solana the fee payer is the first signer of a transaction.
 *
 * Whoever pays a transaction's fee signed it. If one account signs transactions that move another
 * account's assets, one key controls both, or the second account delegated to the first.
 */
export const solanaFeePayer: Signal = {
  id: 'solana-fee-payer',
  category: 'control',
  weight: 0.9,
  title: 'Shared transaction signer',
  namespaces: ['solana'],
  description:
    'The same account paid the fee for, and therefore signed, transactions belonging to both addresses. On Solana the fee payer is the first required signer, so this is direct evidence of a single signing key operating both accounts. Custodial services and relayers also pay fees for their users, so a fee payer that appears across many analysed addresses is discounted, and a labelled service is ignored outright.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.namespace !== 'solana' || right.ref.namespace !== 'solana') continue;

      const shared = [...left.payers].filter((payer) => right.payers.has(payer));
      const peerPays = left.payers.has(right.ref.normalized) || right.payers.has(left.ref.normalized);
      const external = shared.filter(
        (payer) =>
          payer !== left.ref.normalized &&
          payer !== right.ref.normalized &&
          !ctx.labels.isHub('solana', payer) &&
          !ctx.hubs.has(`solana:${payer}`),
      );
      if (!peerPays && external.length === 0) continue;

      if (peerPays) {
        const payer = left.payers.has(right.ref.normalized) ? right : left;
        const paid = payer === left ? right : left;
        out.push(
          makeEvidence({
            signal: solanaFeePayer,
            a: left.key,
            b: right.key,
            strength: 0.95,
            title: 'One address signs for the other',
            detail: `${payer.ref.address} paid the fee for transactions involving ${paid.ref.address}. The fee payer is a required signer, so the same key authorised both sides.`,
            observations: [
              { label: 'Signer', value: payer.ref.address },
              { label: 'Signed for', value: paid.ref.address },
            ],
            references: [addressRef('solana', payer.ref.normalized, 'Signer')],
          }),
        );
        continue;
      }

      const payer = external[0] as string;
      const holders = ctx.sharedBy.get(`solana:${payer}`)?.size ?? 2;
      const exclusivity = holders <= 2 ? 1 : Math.max(0.3, 1 - (holders - 2) / Math.max(2, ctx.index.size - 2));
      out.push(
        makeEvidence({
          signal: solanaFeePayer,
          a: left.key,
          b: right.key,
          strength: Math.min(1, (0.6 + 0.3 * saturate(external.length, 2)) * exclusivity),
          title: 'A third account signs for both',
          detail: `${payer} paid fees for transactions belonging to both addresses. That account holds a key able to authorise both.`,
          observations: [
            { label: 'Shared signer', value: payer },
            { label: 'Signers in common', value: String(external.length) },
          ],
          references: external.slice(0, 4).map((address, i) => addressRef('solana', address, `Signer ${i + 1}`)),
        }),
      );
    }
    return out;
  },
};

/**
 * Solana token accounts are owned by a wallet, and that ownership is on chain.
 *
 * If one of the analysed addresses is a token account whose owner is another analysed address, they
 * are not merely linked: one is a component of the other.
 */
export const solanaAccountControl: Signal = {
  id: 'solana-account-control',
  category: 'control',
  weight: 1,
  title: 'On-chain ownership',
  namespaces: ['solana'],
  description:
    'One address is an SPL token account owned by the other, or was created and rent funded by it. Token account ownership is recorded in account state rather than inferred from behaviour, so this is a fact rather than a heuristic. Rent funding is slightly weaker: a service can open an account on a user\'s behalf, and that case is scored below outright ownership.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.namespace !== 'solana' || right.ref.namespace !== 'solana') continue;

      for (const [child, parent] of [
        [left, right],
        [right, left],
      ] as const) {
        const tokenAccount = child.bundle.facts.solanaTokenAccount;
        if (tokenAccount && tokenAccount.owner === parent.ref.normalized) {
          out.push(
            makeEvidence({
              signal: solanaAccountControl,
              a: left.key,
              b: right.key,
              strength: 1,
              title: 'One address is a token account of the other',
              detail: `${child.ref.address} is an SPL token account for mint ${tokenAccount.mint}, owned on chain by ${parent.ref.address}. Only the owner can move its balance.`,
              observations: [
                { label: 'Token account', value: child.ref.address },
                { label: 'Owner', value: parent.ref.address },
                { label: 'Mint', value: tokenAccount.mint },
              ],
              references: [addressRef('solana', child.ref.normalized, 'Token account')],
            }),
          );
          continue;
        }

        const rentPayer = child.bundle.facts.rentPayer;
        if (rentPayer && rentPayer === parent.ref.normalized) {
          out.push(
            makeEvidence({
              signal: solanaAccountControl,
              a: left.key,
              b: right.key,
              strength: 0.8,
              title: 'One address paid to create the other',
              detail: `${parent.ref.address} paid the rent that brought ${child.ref.address} into existence.`,
              observations: [
                { label: 'Created account', value: child.ref.address },
                { label: 'Rent payer', value: parent.ref.address },
              ],
              references: [addressRef('solana', parent.ref.normalized, 'Rent payer')],
            }),
          );
        }
      }
    }
    return out;
  },
};

/**
 * EVM contract deployment ties a contract to the externally owned account that created it.
 */
export const evmDeployer: Signal = {
  id: 'evm-deployer',
  category: 'control',
  weight: 0.85,
  title: 'Deployment relationship',
  namespaces: ['evm'],
  description:
    'One address deployed the other, or both were deployed by the same externally owned account. A contract\'s deployer is recorded in the chain\'s own history, and factories aside, the deployer is the party that put the contract there. Deployments by a shared public factory are excluded, since anyone can call one.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.namespace !== 'evm' || right.ref.namespace !== 'evm') continue;

      for (const [contract, deployer] of [
        [left, right],
        [right, left],
      ] as const) {
        if (contract.bundle.facts.creator && contract.bundle.facts.creator === deployer.ref.normalized) {
          out.push(
            makeEvidence({
              signal: evmDeployer,
              a: left.key,
              b: right.key,
              strength: 1,
              title: 'One address deployed the other',
              detail: `${deployer.ref.address} deployed the contract at ${contract.ref.address}.`,
              observations: [
                { label: 'Contract', value: contract.ref.address },
                { label: 'Deployer', value: deployer.ref.address },
                ...(contract.bundle.facts.creationTx
                  ? [{ label: 'Creation tx', value: contract.bundle.facts.creationTx }]
                  : []),
              ],
              references: [addressRef(contract.ref.chain, contract.ref.normalized, 'Contract')],
            }),
          );
        }
      }

      const a = left.bundle.facts.creator;
      const b = right.bundle.facts.creator;
      if (a && b && a === b && !ctx.labels.isHub(left.ref.chain, a)) {
        out.push(
          makeEvidence({
            signal: evmDeployer,
            a: left.key,
            b: right.key,
            strength: 0.9,
            title: 'Deployed by the same account',
            detail: `Both contracts were deployed by ${a}.`,
            observations: [{ label: 'Deployer', value: a }],
            references: [addressRef(left.ref.chain, a, 'Deployer')],
          }),
        );
      }
    }
    return out;
  },
};

/**
 * Gas top-ups are a control relationship in EVM land: a fresh wallet cannot move until someone
 * pays for its first transaction.
 */
export const gasFunding: Signal = {
  id: 'gas-funding',
  category: 'control',
  weight: 0.7,
  title: 'Gas sponsorship',
  namespaces: ['evm'],
  description:
    'One address repeatedly sends small native-token amounts to the other, in sizes that only make sense as gas. Sponsoring another wallet\'s fees is an operational act: the sponsor wants that wallet to transact. Occasional single top-ups between friends produce the same shape, so repetition is what carries the weight here.',
  run(ctx: SignalContext): Evidence[] {
    const out: Evidence[] = [];
    for (const [left, right] of pairs(ctx)) {
      if (left.ref.namespace !== 'evm' || right.ref.namespace !== 'evm') continue;
      if (left.ref.chain !== right.ref.chain) continue;

      for (const [sponsor, funded] of [
        [left, right],
        [right, left],
      ] as const) {
        const transfers = (funded.funders.get(sponsor.ref.normalized) ?? []).filter(
          (t) => t.asset.kind === 'native' && t.success && t.value > 0 && t.value <= 0.05,
        );
        if (transfers.length < 2) continue;
        const latest = transfers.reduce((best, t) => (t.ts > best.ts ? t : best), transfers[0] as Transfer);
        out.push(
          makeEvidence({
            signal: gasFunding,
            a: left.key,
            b: right.key,
            strength: Math.min(1, 0.5 + 0.5 * saturate(transfers.length, 3)),
            title: 'Repeated gas top-ups',
            detail: `${sponsor.ref.address} sent ${transfers.length} small native transfers to ${funded.ref.address}, all under the size of a routine gas top-up.`,
            observations: [
              { label: 'Sponsor', value: sponsor.ref.address },
              { label: 'Recipient', value: funded.ref.address },
              { label: 'Top-ups received', value: String(transfers.length), tone: 'in' },
              { label: 'Most recent', value: formatTimestamp(latest.ts) },
            ],
            references: transfers.slice(0, 4).map((t, i) => txRef(t, `Top-up ${i + 1}`)),
            lastSeen: latest.ts,
          }),
        );
      }
    }
    return out;
  },
};
