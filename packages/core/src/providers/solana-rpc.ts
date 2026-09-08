import pLimit from 'p-limit';
import { getChain } from '../chains.js';

import { cached } from '../util/cache.js';
import { fetchJson } from '../util/http.js';
import { byHealth, penalize } from '../util/scheduler.js';
import { fromBaseUnits } from '../util/units.js';
import type { AccountFacts, AddressRef, ChainDescriptor, Transfer } from '../types.js';
import { dedupe, trim } from './evm-common.js';
import type { ChainProvider, CollectOptions, FetchContext, ProviderActivity } from './types.js';

const IMMUTABLE_TTL = 7 * 24 * 3600;

/** How many requests to have in flight per endpoint. The scheduler still paces them. */
const FANOUT = Number(process.env.BRAID_SOLANA_FANOUT ?? 6);

/** Learned per-host caps, e.g. publicnode allows one getTransaction per batch and says so. */
const BATCH_LIMITS = new Map<string, number>();

function batchLimit(host: string, method: string): number {
  // getTransaction defaults to one call per request because the public endpoints disagree about
  // batching it and the ones that refuse do so with an HTTP 400, which costs a whole round trip to
  // discover. Starting at one is never wrong; larger batches are only used where an endpoint has
  // been configured or observed to accept them.
  return BATCH_LIMITS.get(`${host}|${method}`) ?? (method === 'getTransaction' ? 1 : 10);
}

function setBatchLimit(host: string, method: string, limit: number): void {
  BATCH_LIMITS.set(`${host}|${method}`, Math.max(1, limit));
}

/** Reads "Maximum number of 'x' calls in a batch request is N" out of an endpoint's error text. */
export function parseBatchLimit(message: string | undefined): number | undefined {
  const match = /batch request is (\d+)/i.exec(message ?? '');
  return match ? Number(match[1]) : undefined;
}

/** Per-item errors that mean "ask again", as opposed to "this transaction does not exist". */
export function isRetryable(error: { code: number; message: string }): boolean {
  if (error.code === 429 || error.code === -32005 || error.code === -32603) return true;
  return /too many requests|rate limit|timeout|temporarily/i.test(error.message ?? '');
}

const DEFAULT_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

interface RpcResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

interface ParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
  accounts?: string[];
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
}

function rpcUrls(): string[] {
  const configured = (process.env.SOLANA_RPC_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const helius = process.env.HELIUS_API_KEY?.trim();
  const urls = [...configured];
  if (helius) urls.unshift(`https://mainnet.helius-rpc.com/?api-key=${helius}`);
  for (const fallback of DEFAULT_RPCS) if (!urls.includes(fallback)) urls.push(fallback);
  return urls;
}

/**
 * Solana history over plain JSON-RPC.
 *
 * Works against any RPC endpoint, defaults to keyless public ones, and fails over to the next URL
 * in the list when a node rate limits or errors. Requests are batched (JSON-RPC arrays) because
 * public nodes charge per HTTP call, not per method.
 */
export class SolanaRpcProvider implements ChainProvider {
  readonly name = 'solana-rpc';
  readonly namespace = 'solana' as const;
  readonly priority = 50;

  private readonly urls: string[];

  constructor(urls: string[] = rpcUrls()) {
    this.urls = urls;
  }

  supports(chain: ChainDescriptor): boolean {
    return chain.namespace === 'solana';
  }

  /**
   * Sends JSON-RPC calls, adapting to whatever the endpoint actually allows.
   *
   * Public Solana nodes disagree about batching: one caps `getTransaction` at a single call per
   * batch and says so in an error, another accepts batches but rate limits per method and reports
   * that as a *per item* error inside a 200 response. Both of those look like success to naive
   * client code, which is how a linkage tool ends up quietly analysing half the data it thinks it
   * has. This method reads the batch-limit error and shrinks accordingly, treats per-item rate
   * limits as retryable, rotates endpoints, and reports anything it could not resolve.
   */
  private async rpcMany<T>(
    method: string,
    paramSets: unknown[][],
    ctx: FetchContext,
    onUnresolved?: (count: number) => void,
    urlOverride?: string[],
  ): Promise<(T | undefined)[]> {
    const endpoints = urlOverride ?? this.urls;
    const results = new Array<T | undefined>(paramSets.length);
    let pending = paramSets.map((_, i) => i);

    for (let round = 0; round < 3 && pending.length > 0; round += 1) {
      // Endpoints are ordered by how well they have actually been serving us, so a node that is
      // rate limiting every call drops to the back instead of eating a third of the requests.
      const ordered = urlOverride ?? byHealth(endpoints);
      for (let hop = 0; hop < ordered.length && pending.length > 0; hop += 1) {
        const url = ordered[hop] as string;
        const host = new URL(url).host;
        const stillPending: number[] = [];
        const size = batchLimit(host, method);
        const chunks: number[][] = [];
        for (let offset = 0; offset < pending.length; offset += size) {
          chunks.push(pending.slice(offset, offset + size));
        }

        // Chunks are dispatched concurrently and the shared per-host scheduler decides the real
        // pace. Issuing them one at a time would serialise a hundred single-call requests behind
        // one round trip each, which is what makes a keyless Solana walk feel broken.
        const dispatch = pLimit(FANOUT);
        const retryChunks: number[][] = [];
        await Promise.all(
          chunks.map((slice) =>
            dispatch(async () => {
              if (Date.now() >= ctx.deadline) {
                stillPending.push(...slice);
                return;
              }
              const requests: RpcRequest[] = slice.map((index, i) => ({
                jsonrpc: '2.0',
                id: i,
                method,
                params: paramSets[index] as unknown[],
              }));

              let responses: RpcResponse<T>[] | RpcResponse<T>;
              try {
                responses = await fetchJson<RpcResponse<T>[] | RpcResponse<T>>(this.name, url, {
                  method: 'POST',
                  body: requests,
                  timeoutMs: 25_000,
                  retries: 1,
                  signal: ctx.signal,
                  onAttempt: (info) => ctx.stats.record(this.name, 'solana', info),
                });
              } catch (err) {
                // A cap like "maximum getTransaction calls in a batch request is 1" arrives as an
                // HTTP error, so the limit has to be recovered from the failure rather than the body.
                const capped = parseBatchLimit((err as Error).message);
                if (capped !== undefined && capped < slice.length) {
                  setBatchLimit(host, method, capped);
                  ctx.stats.note(this.name, 'solana', `${host} caps ${method} at ${capped} per batch`);
                  retryChunks.push(slice);
                  return;
                }
                ctx.stats.note(this.name, 'solana', `failed over from ${host}`);
                stillPending.push(...slice);
                return;
              }

              if (!Array.isArray(responses)) {
                const capped = parseBatchLimit(responses.error?.message);
                if (capped !== undefined && capped < slice.length) {
                  setBatchLimit(host, method, capped);
                  ctx.stats.note(this.name, 'solana', `${host} caps ${method} at ${capped} per batch`);
                  retryChunks.push(slice);
                  return;
                }
                stillPending.push(...slice);
                return;
              }

              const byId = new Map(responses.map((response) => [response.id, response]));
              let throttled = 0;
              slice.forEach((index, i) => {
                const response = byId.get(i);
                if (!response) {
                  stillPending.push(index);
                  return;
                }
                if (response.error) {
                  if (isRetryable(response.error)) {
                    throttled += 1;
                    stillPending.push(index);
                  } else {
                    results[index] = undefined;
                  }
                  return;
                }
                results[index] = response.result;
              });
              // A node that answers HTTP 200 with a body full of rate-limit errors is throttling us
              // just as surely as one that answers 429. Without this the endpoint would keep
              // scoring as healthy and keep receiving work it will not serve.
              if (throttled > 0) penalize(host);
            }),
          ),
        );

        // A chunk rejected purely for being too large is re-queued at the newly learned size.
        if (retryChunks.length > 0) stillPending.push(...retryChunks.flat());

        pending = stillPending;
      }
      if (pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** round));
    }

    if (pending.length > 0) onUnresolved?.(pending.length);
    return results;
  }

  private async call<T>(
    method: string,
    params: unknown[],
    ctx: FetchContext,
    urlOverride?: string[],
  ): Promise<T | undefined> {
    const [result] = await this.rpcMany<T>(method, [params], ctx, undefined, urlOverride);
    return result;
  }

  /**
   * Fetches one page of signatures and verifies it is not silently truncated.
   *
   * Public Solana endpoints do not all serve the same depth of history: one of the defaults returns
   * six signatures for an account where another returns a hundred, with no error and no indication
   * that anything was withheld. A linkage tool that believes the short answer concludes an account
   * has almost no history, and then reports the earliest transfer it happened to see as the
   * account's opening balance. So a page shorter than requested is never taken at face value: every
   * other configured endpoint is asked the same question and the fullest answer wins.
   */
  private async signaturePage(
    address: string,
    before: string | undefined,
    limit: number,
    ctx: FetchContext,
    warnings: string[],
  ): Promise<{ page: SignatureInfo[] | undefined; confirmedShort: boolean }> {
    const params = [address, { limit, ...(before ? { before } : {}) }];
    const primary = await this.call<SignatureInfo[]>('getSignaturesForAddress', params, ctx);
    if (primary && primary.length >= limit) return { page: primary, confirmedShort: false };
    if (this.urls.length < 2) return { page: primary, confirmedShort: primary !== undefined };

    let best = primary;
    let disagreed = false;
    for (const url of this.urls) {
      if (Date.now() >= ctx.deadline) break;
      const candidate = await this.call<SignatureInfo[]>('getSignaturesForAddress', params, ctx, [url]);
      if (!candidate) continue;
      if (!best || candidate.length > best.length) {
        if (best && candidate.length > best.length) disagreed = true;
        best = candidate;
      } else if (candidate.length < best.length) {
        disagreed = true;
      }
      if (best.length >= limit) break;
    }
    if (disagreed) {
      const host = 'configured Solana RPC endpoints';
      warnings.push(
        `${host} returned different amounts of history for ${address}; the fullest response was used`,
      );
      ctx.stats.note(this.name, 'solana', 'endpoints disagreed on history depth; used the fullest response');
    }
    return { page: best, confirmedShort: best !== undefined && best.length < limit };
  }

  /** Resolves parsed transactions, using a long cache because a confirmed transaction never changes. */
  private async getTransactions(
    signatures: string[],
    ctx: FetchContext,
    warnings: string[],
  ): Promise<Map<string, ParsedTransaction>> {
    const out = new Map<string, ParsedTransaction>();
    const misses: string[] = [];

    await Promise.all(
      signatures.map(async (signature) => {
        const hit = await ctx.cache.get(`sol:tx:${signature}`);
        if (!hit) {
          misses.push(signature);
          return;
        }
        try {
          out.set(signature, JSON.parse(hit) as ParsedTransaction);
        } catch {
          misses.push(signature);
        }
      }),
    );

    if (misses.length === 0) return out;

    const fetched = await this.rpcMany<ParsedTransaction>(
      'getTransaction',
      misses.map((signature) => [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]),
      ctx,
      (count) => warnings.push(`${count} transaction(s) could not be read from any configured Solana RPC`),
    );

    await Promise.all(
      fetched.map(async (transaction, i) => {
        const signature = misses[i] as string;
        if (!transaction) return;
        out.set(signature, transaction);
        await ctx.cache.set(`sol:tx:${signature}`, JSON.stringify(transaction), IMMUTABLE_TTL);
      }),
    );

    return out;
  }

  async fetchFacts(ref: AddressRef, ctx: FetchContext): Promise<Partial<AccountFacts>> {
    const info = await cached(ctx.cache, `sol:info:${ref.normalized}`, ctx.cacheTtlSeconds, async () =>
      this.call<{
        value: {
          lamports: number;
          owner: string;
          executable: boolean;
          data?: { parsed?: { type?: string; info?: { owner?: string; mint?: string } } };
        } | null;
      }>('getAccountInfo', [ref.address, { encoding: 'jsonParsed' }], ctx).catch(() => undefined),
    );
    const value = info?.value;
    if (!value) return {};
    const facts: Partial<AccountFacts> = {
      balance: fromBaseUnits(String(value.lamports ?? 0), 9),
      isContract: value.executable === true,
    };
    const parsed = value.data?.parsed;
    if (parsed?.type === 'account' && parsed.info?.owner && parsed.info?.mint && TOKEN_PROGRAMS.has(value.owner)) {
      facts.solanaTokenAccount = { owner: parsed.info.owner, mint: parsed.info.mint };
    }
    return facts;
  }

  async fetchActivity(ref: AddressRef, options: CollectOptions, ctx: FetchContext): Promise<ProviderActivity> {
    const chain = getChain('solana');
    const warnings: string[] = [];
    const signatures: SignatureInfo[] = [];
    let before: string | undefined;
    let reachedEnd = false;

    // Solana history is walked one page at a time and public nodes throttle hard, so the
    // signature budget tracks the transfer budget rather than doubling it.
    const signatureBudget = Math.min(options.maxTransfers, 600);
    while (signatures.length < signatureBudget) {
      if (Date.now() >= ctx.deadline) {
        warnings.push('signature walk stopped early: time budget reached');
        break;
      }
      const { page, confirmedShort } = await cached(
        ctx.cache,
        `sol:sigs:v2:${ref.normalized}:${before ?? 'head'}`,
        ctx.cacheTtlSeconds,
        () => this.signaturePage(ref.address, before, 100, ctx, warnings),
      );
      // An unreadable page is a provider failure, not the end of the account's history. Conflating
      // the two would let a rate limit masquerade as "we saw everything", which is exactly the
      // premise the first-funding signals rely on.
      if (!page) {
        warnings.push('the signature walk stopped early: no configured Solana RPC could serve the next page');
        break;
      }
      if (page.length === 0) {
        reachedEnd = true;
        break;
      }
      for (const entry of page) {
        if (options.since && entry.blockTime && entry.blockTime < options.since) {
          reachedEnd = true;
          break;
        }
        signatures.push(entry);
      }
      if (reachedEnd) break;
      // Every endpoint agrees this page is short, so it is the tail of the account's history.
      if (confirmedShort) {
        reachedEnd = true;
        break;
      }
      before = page[page.length - 1]?.signature;
      // A short page is not proof of the end of history: public nodes routinely return fewer
      // signatures than asked for. Only an empty page settles it, so the walk keeps going and
      // pays one extra request rather than claiming a completeness it has not established.
    }

    const wanted = signatures.slice(0, signatureBudget);
    const parsedBySignature = await this.getTransactions(
      wanted.map((entry) => entry.signature),
      ctx,
      warnings,
    );

    const transfers: Transfer[] = [];
    const payers = new Set<string>();
    let rentPayer: string | undefined;
    let parsedCount = 0;

    for (const entry of wanted) {
      const tx = parsedBySignature.get(entry.signature);
      if (!tx) continue;
      parsedCount += 1;
      const extracted = extractTransfers(tx, entry.signature, chain.slug);
      for (const transfer of extracted.transfers) transfers.push(transfer);
      if (extracted.feePayer) payers.add(extracted.feePayer);
      const creator = extracted.createdAccounts.get(ref.normalized);
      if (creator) rentPayer = creator;
    }

    if (parsedCount === 0 && wanted.length > 0) {
      warnings.push('no transactions could be decoded from the configured Solana RPC endpoints');
    }

    // Keep movements the account was actually party to, plus anything it paid the fee for: a
    // wallet that signs and funds another account's transfer is exactly the control relationship
    // the fee-payer signal is looking for.
    const relevant = transfers.filter(
      (t) => t.from === ref.normalized || t.to === ref.normalized || t.payer === ref.normalized,
    );
    const result = trim(dedupe(relevant), options.maxTransfers);
    const facts: Partial<AccountFacts> = {};
    if (rentPayer) facts.rentPayer = rentPayer;

    return {
      transfers: result.transfers,
      payers: [...payers],
      truncated: result.truncated || (!reachedEnd && signatures.length >= signatureBudget),
      // Solana signatures page backwards only, so genesis is proven exactly when the walk ran out
      // of signatures rather than out of budget.
      reachedGenesis: reachedEnd && signatures.length < signatureBudget,
      warnings,
      facts,
    };
  }
}

interface Extraction {
  transfers: Transfer[];
  feePayer?: string;
  /** account -> funder that paid its rent, when the transaction created it. */
  createdAccounts: Map<string, string>;
}

/**
 * Turns one parsed transaction into normalized transfers.
 *
 * Parsed instructions are used when the RPC decodes them, because they name sender and recipient
 * exactly. Anything the node could not decode falls back to net balance deltas, which is the only
 * honest reading of a transaction whose instructions are opaque; those transfers are marked with
 * index >= 500000 so callers can tell exact pairs from inferred ones.
 */
export function extractTransfers(tx: ParsedTransaction, signature: string, chain: string): Extraction {
  const created = new Map<string, string>();
  const out: Transfer[] = [];
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const feePayer = keys[0];
  const ts = tx.blockTime ?? 0;
  const success = !tx.meta?.err;

  const instructions: ParsedInstruction[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions),
  ];

  const ownerByTokenAccount = new Map<string, { owner: string; mint: string; decimals: number }>();
  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    const pubkey = keys[balance.accountIndex];
    if (pubkey && balance.owner) {
      ownerByTokenAccount.set(pubkey, {
        owner: balance.owner,
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
      });
    }
  }

  let index = 0;
  for (const instruction of instructions) {
    const parsed = instruction.parsed;
    if (!parsed?.info) continue;
    const info = parsed.info as Record<string, string | number>;
    const programId = instruction.programId ?? '';

    if (instruction.program === 'system' || programId === SYSTEM_PROGRAM) {
      if (parsed.type === 'transfer' || parsed.type === 'transferWithSeed') {
        const lamports = String(info.lamports ?? '0');
        out.push({
          chain,
          txHash: signature,
          ts,
          blockNumber: tx.slot,
          from: String(info.source ?? ''),
          to: String(info.destination ?? ''),
          kind: 'native',
          asset: { kind: 'native', symbol: 'SOL', decimals: 9 },
          rawValue: lamports,
          value: fromBaseUnits(lamports, 9),
          success,
          payer: feePayer,
          index: index++,
        });
      } else if (parsed.type === 'createAccount' || parsed.type === 'createAccountWithSeed') {
        const newAccount = String(info.newAccount ?? '');
        const source = String(info.source ?? feePayer ?? '');
        if (newAccount) created.set(newAccount, source);
        const lamports = String(info.lamports ?? '0');
        if (lamports !== '0' && source && newAccount) {
          out.push({
            chain,
            txHash: signature,
            ts,
            blockNumber: tx.slot,
            from: source,
            to: newAccount,
            kind: 'native',
            asset: { kind: 'native', symbol: 'SOL', decimals: 9 },
            rawValue: lamports,
            value: fromBaseUnits(lamports, 9),
            success,
            payer: feePayer,
            index: index++,
          });
        }
      }
      continue;
    }

    if (instruction.program === 'spl-associated-token-account' && parsed.type?.startsWith('create')) {
      const account = String(info.account ?? '');
      const source = String(info.source ?? feePayer ?? '');
      if (account && source) created.set(account, source);
      continue;
    }

    if (instruction.program === 'spl-token' || TOKEN_PROGRAMS.has(programId)) {
      if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue;
      const sourceAccount = String(info.source ?? '');
      const destAccount = String(info.destination ?? '');
      const sourceOwner = ownerByTokenAccount.get(sourceAccount)?.owner ?? String(info.authority ?? sourceAccount);
      const destMeta = ownerByTokenAccount.get(destAccount);
      const destOwner = destMeta?.owner ?? destAccount;
      const mint =
        String(info.mint ?? '') || destMeta?.mint || ownerByTokenAccount.get(sourceAccount)?.mint || undefined;
      const decimals =
        typeof (info.tokenAmount as unknown as { decimals?: number })?.decimals === 'number'
          ? ((info.tokenAmount as unknown as { decimals: number }).decimals)
          : destMeta?.decimals ?? ownerByTokenAccount.get(sourceAccount)?.decimals ?? 0;
      const amount = String(
        (info.amount as string) ?? (info.tokenAmount as unknown as { amount?: string })?.amount ?? '0',
      );
      if (!sourceOwner || !destOwner) continue;
      out.push({
        chain,
        txHash: signature,
        ts,
        blockNumber: tx.slot,
        from: sourceOwner,
        to: destOwner,
        kind: 'token',
        asset: { kind: 'token', address: mint, decimals },
        rawValue: amount,
        value: fromBaseUnits(amount, decimals),
        success,
        payer: feePayer,
        index: 200_000 + index++,
      });
    }
  }

  if (out.length === 0 && tx.meta) {
    for (const transfer of deltaTransfers(tx, signature, chain, keys, feePayer)) out.push(transfer);
  }

  return { transfers: out, feePayer, createdAccounts: created };
}

/** Greedy net-flow pairing from lamport balance deltas, used only when no instruction decoded. */
function deltaTransfers(
  tx: ParsedTransaction,
  signature: string,
  chain: string,
  keys: string[],
  feePayer: string | undefined,
): Transfer[] {
  const meta = tx.meta;
  if (!meta) return [];
  const deltas: { key: string; delta: number }[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const pre = meta.preBalances[i] ?? 0;
    const post = meta.postBalances[i] ?? 0;
    let delta = post - pre;
    if (i === 0) delta += meta.fee;
    if (Math.abs(delta) < 1000) continue;
    deltas.push({ key: keys[i] as string, delta });
  }
  const senders = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta);
  const receivers = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);
  const out: Transfer[] = [];
  let si = 0;
  let ri = 0;
  let remainingOut = senders[0] ? -senders[0].delta : 0;
  let remainingIn = receivers[0]?.delta ?? 0;
  let guard = 0;
  while (si < senders.length && ri < receivers.length && guard < 64) {
    guard += 1;
    const amount = Math.min(remainingOut, remainingIn);
    if (amount > 0) {
      out.push({
        chain,
        txHash: signature,
        ts: tx.blockTime ?? 0,
        blockNumber: tx.slot,
        from: senders[si]?.key as string,
        to: receivers[ri]?.key as string,
        kind: 'native',
        asset: { kind: 'native', symbol: 'SOL', decimals: 9 },
        rawValue: String(amount),
        value: fromBaseUnits(String(amount), 9),
        success: !meta.err,
        payer: feePayer,
        index: 500_000 + out.length,
      });
    }
    remainingOut -= amount;
    remainingIn -= amount;
    if (remainingOut <= 0) {
      si += 1;
      remainingOut = senders[si] ? -(senders[si] as { delta: number }).delta : 0;
    }
    if (remainingIn <= 0) {
      ri += 1;
      remainingIn = receivers[ri]?.delta ?? 0;
    }
  }
  return out;
}
