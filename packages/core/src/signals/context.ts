import { addressKey } from '../address.js';
import { addressUrl, txUrl } from '../chains.js';
import { labels, type LabelRegistry } from '../labels/index.js';
import type { ContextAccount } from '../collect.js';
import type {
  ActivityBundle,
  AddressRef,
  AnalysisOptions,
  Evidence,
  Namespace,
  Observation,
  SignalCategory,
  Transfer,
} from '../types.js';

/** Per-address derived views. Every signal reads these instead of re-walking raw transfers. */
export interface BundleIndex {
  key: string;
  ref: AddressRef;
  bundle: ActivityBundle;
  inbound: Transfer[];
  outbound: Transfer[];
  /** Non-self counterparties, normalized, hubs included (signals filter as they need). */
  counterparties: Set<string>;
  /** Funder address -> the inbound transfers it sent. */
  funders: Map<string, Transfer[]>;
  /** Payee address -> the outbound transfers sent to it. */
  payees: Map<string, Transfer[]>;
  /** Earliest successful inbound value transfer, the account's opening funding. */
  firstFunding?: { address: string; transfer: Transfer };
  /** UTC hour-of-day histogram over all activity. */
  hours: number[];
  /** Token contracts / mints the account has held or moved. */
  assets: Set<string>;
  /** Fee payers or transaction senders that moved value for this account. */
  payers: Set<string>;
}

export interface SignalContext {
  bundles: ActivityBundle[];
  index: Map<string, BundleIndex>;
  order: string[];
  context: Map<string, ContextAccount>;
  labels: LabelRegistry;
  options: AnalysisOptions;
  now: number;
  /** Counterparty key -> the input address keys that touched it. */
  sharedBy: Map<string, Set<string>>;
  /** Counterparty keys that carry no ownership information. */
  hubs: Set<string>;
}

export interface Signal {
  id: string;
  category: SignalCategory;
  weight: number;
  title: string;
  /** One paragraph explaining what the signal proves and how it can be wrong. Rendered in the docs. */
  description: string;
  /** Namespaces the signal applies to. Omitted means every namespace. */
  namespaces?: Namespace[];
  run(ctx: SignalContext): Evidence[];
}

export function buildIndex(bundle: ActivityBundle): BundleIndex {
  const self = bundle.ref.normalized;
  const inbound: Transfer[] = [];
  const outbound: Transfer[] = [];
  const counterparties = new Set<string>();
  const funders = new Map<string, Transfer[]>();
  const payees = new Map<string, Transfer[]>();
  const hours = new Array<number>(24).fill(0);
  const assets = new Set<string>();

  for (const transfer of bundle.transfers) {
    if (transfer.asset.address) assets.add(transfer.asset.address);
    if (transfer.ts) {
      const hour = new Date(transfer.ts * 1000).getUTCHours();
      hours[hour] = (hours[hour] ?? 0) + 1;
    }
    if (transfer.to === self && transfer.from !== self) {
      inbound.push(transfer);
      counterparties.add(transfer.from);
      const list = funders.get(transfer.from) ?? [];
      list.push(transfer);
      funders.set(transfer.from, list);
    } else if (transfer.from === self && transfer.to !== self) {
      outbound.push(transfer);
      counterparties.add(transfer.to);
      const list = payees.get(transfer.to) ?? [];
      list.push(transfer);
      payees.set(transfer.to, list);
    }
  }

  const opening = inbound
    .filter((t) => t.success && t.value > 0)
    .sort((a, b) => a.ts - b.ts)[0];

  return {
    key: bundle.ref.key,
    ref: bundle.ref,
    bundle,
    inbound,
    outbound,
    counterparties,
    funders,
    payees,
    firstFunding: opening ? { address: opening.from, transfer: opening } : undefined,
    hours,
    assets,
    payers: new Set(bundle.payers.filter((p) => p !== self)),
  };
}

export function buildContext(
  bundles: ActivityBundle[],
  context: Map<string, ContextAccount>,
  options: AnalysisOptions,
  now = Math.floor(Date.now() / 1000),
): SignalContext {
  const registry = labels();
  const index = new Map<string, BundleIndex>();
  for (const bundle of bundles) index.set(bundle.ref.key, buildIndex(bundle));

  const inputs = new Set(index.keys());
  const sharedBy = new Map<string, Set<string>>();
  for (const entry of index.values()) {
    for (const party of entry.counterparties) {
      const key = addressKey(entry.ref.chain, party);
      if (inputs.has(key)) continue;
      const holders = sharedBy.get(key) ?? new Set<string>();
      holders.add(entry.key);
      sharedBy.set(key, holders);
    }
  }

  const hubs = new Set<string>();
  for (const [key, holders] of sharedBy) {
    const idx = key.indexOf(':');
    const chain = key.slice(0, idx);
    const address = key.slice(idx + 1);
    if (registry.isHub(chain, address)) {
      hubs.add(key);
      continue;
    }
    if (context.get(key)?.facts.isContract) {
      hubs.add(key);
      continue;
    }
    const share = holders.size / Math.max(1, inputs.size);
    if (holders.size >= options.hubShareThreshold && share >= 0.8) hubs.add(key);
  }

  return {
    bundles,
    index,
    order: [...index.keys()],
    context,
    labels: registry,
    options,
    now,
    sharedBy,
    hubs,
  };
}

/** Every unordered pair of input addresses, in a stable order. */
export function pairs(ctx: SignalContext): [BundleIndex, BundleIndex][] {
  const list = ctx.order.map((key) => ctx.index.get(key) as BundleIndex);
  const out: [BundleIndex, BundleIndex][] = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      out.push([list[i] as BundleIndex, list[j] as BundleIndex]);
    }
  }
  return out;
}

export function isHub(ctx: SignalContext, chain: string, address: string): boolean {
  const key = addressKey(chain, address);
  return ctx.hubs.has(key) || ctx.labels.isHub(chain, address);
}

export function counterpartyName(ctx: SignalContext, chain: string, address: string): string | undefined {
  return ctx.labels.lookup(chain, address)?.name ?? ctx.context.get(addressKey(chain, address))?.facts.name;
}

export function txRef(transfer: Transfer, label: string): Observation {
  return { label, value: transfer.txHash, url: txUrl(transfer.chain, transfer.txHash) };
}

export function addressRef(chain: string, address: string, label: string): Observation {
  return { label, value: address, url: addressUrl(chain, address) };
}

export interface EvidenceInit {
  signal: Signal;
  a: string;
  b: string;
  strength: number;
  title: string;
  detail: string;
  observations?: Observation[];
  references?: Observation[];
  lastSeen?: number;
}

export function makeEvidence(init: EvidenceInit): Evidence {
  const strength = Math.max(0, Math.min(1, init.strength));
  const [a, b] = init.a <= init.b ? [init.a, init.b] : [init.b, init.a];
  return {
    signal: init.signal.id,
    category: init.signal.category,
    a,
    b,
    strength,
    weight: init.signal.weight,
    confidence: Number((strength * init.signal.weight).toFixed(4)),
    title: init.title,
    detail: init.detail,
    observations: init.observations ?? [],
    references: init.references ?? [],
    lastSeen: init.lastSeen,
  };
}
