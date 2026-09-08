/**
 * The API contract as the browser sees it.
 *
 * Mirrors `@braid/core`'s report types deliberately: the web client talks to Braid only over HTTP,
 * so it depends on the wire shape rather than on the engine build.
 */
export type Band = 'none' | 'weak' | 'moderate' | 'strong' | 'confirmed';
export type SignalCategory = 'flow' | 'funding' | 'control' | 'coactivity' | 'behavioral';
export type Namespace = 'evm' | 'solana';

export interface Observation {
  label: string;
  value: string;
  url?: string;
}

export interface Evidence {
  signal: string;
  category: SignalCategory;
  a: string;
  b: string;
  strength: number;
  weight: number;
  confidence: number;
  title: string;
  detail: string;
  observations: Observation[];
  references: Observation[];
  lastSeen?: number;
}

export interface LinkEdge {
  a: string;
  b: string;
  score: number;
  band: Band;
  topSignal: string;
  signals: string[];
  crossChain: boolean;
  evidence: Evidence[];
}

export interface Cluster {
  id: string;
  members: string[];
  cohesion: number;
  weakestLink: number;
  chains: string[];
  rationale: string;
}

export interface EntityLabel {
  name: string;
  kind: string;
  hub: boolean;
  source: string;
}

export interface AccountSummary {
  key: string;
  chain: string;
  address: string;
  namespace: Namespace;
  label?: EntityLabel;
  isContract?: boolean;
  /** An EIP-7702 delegated account: an EOA with code, not a contract. */
  delegated?: boolean;
  name?: string;
  balance?: number;
  txCount?: number;
  transfersAnalyzed: number;
  firstActivity?: number;
  lastActivity?: number;
  counterparties: number;
  truncated: boolean;
  historyComplete: boolean;
  warnings: string[];
  explorerUrl: string;
  cluster: string | null;
}

export interface HubNote {
  address: string;
  chain: string;
  label?: EntityLabel;
  sharedBy: number;
  reason: string;
}

export interface ProviderStat {
  provider: string;
  chain: string;
  requests: number;
  errors: number;
  ms: number;
  note?: string;
}

export interface AnalysisOptions {
  maxTransfersPerAddress: number;
  lookbackDays: number;
  minScore: number;
  clusterThreshold: number;
  signals: string[];
  hubShareThreshold: number;
  enrichCounterparties: boolean;
  budgetMs: number;
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

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type ProgressPhase = 'parse' | 'collect' | 'enrich' | 'signals' | 'score' | 'done';

export interface JobView {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: { phase: ProgressPhase; progress: number; message: string; detail?: string };
  addresses: number;
  error?: { code: string; message: string; details?: unknown };
  links: { self: string; events: string; report: string };
}

export interface ChainDescriptor {
  slug: string;
  name: string;
  namespace: Namespace;
  evmChainId?: number;
  nativeSymbol: string;
  explorerAddress: string;
  default?: boolean;
}

export interface SignalDoc {
  id: string;
  title: string;
  category: SignalCategory;
  weight: number;
  namespaces: Namespace[];
  description: string;
}

export interface ParseResult {
  accepted: { key: string; chain: string; address: string; namespace: Namespace; explicit: boolean }[];
  rejected: { input: string; reason: string }[];
  distinctInputs: number;
}
