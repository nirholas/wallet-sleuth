/**
 * Wire and domain types for the Wallet Sleuth linkage engine.
 *
 * Everything the API returns is defined here, so the HTTP contract, the CLI output and the
 * web client all describe the same shapes.
 */

/** Address namespaces Wallet Sleuth understands. */
export type Namespace = 'evm' | 'solana';

/** Broad grouping used to explain *why* a signal counts, in the UI and in reports. */
export type SignalCategory = 'flow' | 'funding' | 'control' | 'coactivity' | 'behavioral';

/** Confidence band derived from an edge score. */
export type Band = 'none' | 'weak' | 'moderate' | 'strong' | 'confirmed';

/** A chain Wallet Sleuth can read. */
export interface ChainDescriptor {
  /** Stable slug used in the API and in address keys, e.g. `ethereum`, `base`, `solana`. */
  slug: string;
  name: string;
  namespace: Namespace;
  /** EIP-155 chain id. Absent for non-EVM chains. */
  evmChainId?: number;
  nativeSymbol: string;
  nativeDecimals: number;
  /** `https://.../address/` prefix. */
  explorerAddress: string;
  /** `https://.../tx/` prefix. */
  explorerTx: string;
  /** Keyless Blockscout instance, when one exists for this chain. */
  blockscout?: string;
  /** Whether Etherscan V2 covers this chain when a key is configured. */
  etherscanV2?: boolean;
  /** True for chains enabled by default when a caller does not name one. */
  default?: boolean;
}

/** A parsed, chain-qualified address. */
export interface AddressRef {
  /** `<chain>:<normalized address>`, the identity used everywhere in a report. */
  key: string;
  chain: string;
  namespace: Namespace;
  /** Checksummed for EVM, base58 for Solana. */
  address: string;
  /** Lowercased EVM address, or the base58 string for Solana. Use for comparisons. */
  normalized: string;
  /** Original string the caller supplied. */
  input: string;
  /**
   * True when the caller named this exact chain. A bare EVM address fans out across every default
   * EVM chain, and those inferred references are dropped when they turn out to have no activity.
   */
  explicit: boolean;
}

export type AssetKind = 'native' | 'token' | 'nft';

export interface Asset {
  kind: AssetKind;
  symbol?: string;
  /** Contract address (EVM) or mint (Solana). */
  address?: string;
  decimals?: number;
}

export type TransferKind = 'native' | 'token' | 'internal' | 'nft';

/** A normalized value movement between two addresses on one chain. */
export interface Transfer {
  chain: string;
  txHash: string;
  /** Unix seconds. */
  ts: number;
  blockNumber?: number;
  /** Normalized sender. */
  from: string;
  /** Normalized recipient. */
  to: string;
  kind: TransferKind;
  asset: Asset;
  /** Base units, as a decimal string. Never lossy. */
  rawValue: string;
  /** Human units. Derived from rawValue and decimals; for heuristics and display only. */
  value: number;
  /** Whether the transaction succeeded. Failed transfers still carry intent. */
  success: boolean;
  /** Solana fee payer, or the EVM transaction sender for internal transfers. */
  payer?: string;
  /** Index that makes the transfer unique inside its transaction. */
  index: number;
}

/** Everything cheap that can be learned about an account without walking its history. */
export interface AccountFacts {
  key: string;
  chain: string;
  address: string;
  isContract?: boolean;
  /**
   * EVM: the account has EIP-7702 delegated code but is still an externally owned account.
   *
   * Explorers report these as contracts, which is true of the bytecode and wrong about the account:
   * a delegated EOA is a person's wallet, and it is one of the most informative counterparties in an
   * analysis. Treating it as a contract would silently discard exactly the evidence worth having.
   */
  delegated?: boolean;
  /** EVM: the implementation an EIP-7702 account delegates to. */
  delegateTo?: string;
  /** EVM: deployer of this contract. */
  creator?: string;
  creationTx?: string;
  /** Reverse name record (ENS on EVM). */
  name?: string;
  /** Native balance in human units. */
  balance?: number;
  /** Total transactions the provider reports, which may exceed what Wallet Sleuth fetched. */
  txCount?: number;
  /** Solana: set when the address is an SPL token account rather than a wallet. */
  solanaTokenAccount?: { owner: string; mint: string };
  /** Solana: the account that paid rent to create this account, when it could be resolved. */
  rentPayer?: string;
  /** Label from the curated entity list, when the address is a known service. */
  label?: EntityLabel;
}

export type EntityKind =
  | 'exchange'
  | 'bridge'
  | 'router'
  | 'mixer'
  | 'staking'
  | 'infrastructure'
  | 'token'
  | 'burn'
  | 'program';

export interface EntityLabel {
  name: string;
  kind: EntityKind;
  /** True when the address serves so many unrelated users that co-occurrence proves nothing. */
  hub: boolean;
  source: string;
}

/** The full activity sample Wallet Sleuth collected for one input address. */
export interface ActivityBundle {
  ref: AddressRef;
  facts: AccountFacts;
  transfers: Transfer[];
  /** Distinct fee payers / senders that signed transactions touching this account. */
  payers: string[];
  /** Earliest inbound transfer observed, which anchors the funding signals. */
  firstInbound?: Transfer;
  /** True when the provider had more history than the configured budget allowed. */
  truncated: boolean;
  /**
   * True when the sample reaches the account's very first transaction.
   *
   * The first-funding signals are only sound when this holds: on a truncated sample the earliest
   * transfer Wallet Sleuth can see is an artefact of the budget, not the account's opening balance.
   */
  reachedGenesis: boolean;
  warnings: string[];
  /** Wall-clock cost of collecting this bundle. */
  fetchMs: number;
  /** Providers that contributed. */
  providers: string[];
}

export interface Observation {
  label: string;
  value: string;
  /** Explorer URL for the underlying transaction or address. */
  url?: string;
}

/** One reason to believe two addresses are related. */
export interface Evidence {
  signal: string;
  category: SignalCategory;
  /** Address key. */
  a: string;
  /** Address key. */
  b: string;
  /** How well this instance of the signal fired, 0..1. */
  strength: number;
  /** The signal's base weight, 0..1. */
  weight: number;
  /** `weight * strength`, the contribution fed into the score. */
  confidence: number;
  title: string;
  detail: string;
  observations: Observation[];
  /** Deep links a human can use to check the claim. */
  references: Observation[];
  /** Unix seconds of the most recent supporting event, when the signal is time-anchored. */
  lastSeen?: number;
}

export interface LinkEdge {
  a: string;
  b: string;
  /** 0..100. */
  score: number;
  band: Band;
  /** Highest-confidence signal on the edge. */
  topSignal: string;
  /** Distinct signals that fired. */
  signals: string[];
  /** True when both addresses live on different chains. */
  crossChain: boolean;
  evidence: Evidence[];
}

export interface Cluster {
  id: string;
  members: string[];
  /** Mean score of the edges that hold the cluster together. */
  cohesion: number;
  /** Lowest edge score inside the spanning set, i.e. the weakest link. */
  weakestLink: number;
  chains: string[];
  /** Plain-language summary of why these addresses were merged. */
  rationale: string;
}

export interface AccountSummary {
  key: string;
  chain: string;
  address: string;
  namespace: Namespace;
  label?: EntityLabel;
  isContract?: boolean;
  /** True for an EIP-7702 delegated account: an EOA with code, not a contract. */
  delegated?: boolean;
  name?: string;
  balance?: number;
  txCount?: number;
  transfersAnalyzed: number;
  firstActivity?: number;
  lastActivity?: number;
  counterparties: number;
  truncated: boolean;
  /** True when the sample reaches the account's first ever transaction. */
  historyComplete: boolean;
  warnings: string[];
  explorerUrl: string;
  /** Cluster the account was assigned to, or null when it stands alone. */
  cluster: string | null;
}

export interface HubNote {
  address: string;
  chain: string;
  label?: EntityLabel;
  /** How many of the input addresses touched it. */
  sharedBy: number;
  reason: string;
}

export interface ProviderStat {
  provider: string;
  chain: string;
  requests: number;
  errors: number;
  ms: number;
  /** Set when the provider degraded, e.g. rate limited or partially unavailable. */
  note?: string;
}

export interface AnalysisOptions {
  /** Maximum transfers pulled per address. Higher is slower and more thorough. */
  maxTransfersPerAddress: number;
  /** Only consider activity newer than this many days. 0 means no limit. */
  lookbackDays: number;
  /** Edges below this score are omitted from the report. */
  minScore: number;
  /** Edges at or above this score merge two addresses into one cluster. */
  clusterThreshold: number;
  /** Signals to run. Empty means every registered signal. */
  signals: string[];
  /** Counterparties touched by at least this many inputs are treated as hubs. */
  hubShareThreshold: number;
  /** Resolve extra facts for shared counterparties (deposit-address detection). Costs requests. */
  enrichCounterparties: boolean;
  /** Whole-analysis budget in milliseconds. Collection stops cleanly when it is spent. */
  budgetMs: number;
}

export interface AnalysisRequest {
  addresses: string[];
  /** Chains to try for bare EVM addresses. Defaults to the registry's default chains. */
  chains?: string[];
  options?: Partial<AnalysisOptions>;
}

export interface AnalysisReport {
  id: string;
  version: string;
  createdAt: string;
  durationMs: number;
  options: AnalysisOptions;
  accounts: AccountSummary[];
  edges: LinkEdge[];
  clusters: Cluster[];
  hubs: HubNote[];
  warnings: string[];
  providers: ProviderStat[];
  /** Addresses the caller supplied that could not be parsed. */
  rejected: { input: string; reason: string }[];
  summary: {
    addresses: number;
    linked: number;
    clusters: number;
    strongestScore: number;
    transfersAnalyzed: number;
    chains: string[];
  };
}

export type ProgressPhase = 'parse' | 'collect' | 'enrich' | 'signals' | 'score' | 'done';

export interface ProgressEvent {
  phase: ProgressPhase;
  /** 0..1 */
  progress: number;
  message: string;
  detail?: string;
}

export type ProgressFn = (event: ProgressEvent) => void;
