# How it works

Wallet Sleuth runs a five stage pipeline. Every stage degrades rather than fails: a provider outage costs
coverage and is written into the report, it never produces invented data.

## 1. Parse and fan out

Input is split on whitespace, commas and semicolons. Each token is classified:

- `0x` followed by 40 hex characters: an EVM address. Normalised to lowercase internally and
  displayed with its EIP-55 checksum.
- 32 bytes of base58: a Solana address.
- `chain:address`: pinned to that chain, e.g. `base:0xabc...` or `solana:9Wz...`.

A bare EVM address is looked up on **every selected EVM chain**, because one private key controls the
same address on all of them, and the linkage you are looking for often lives on a chain you did not
think to ask about. Chain guesses that turn out to have no activity are dropped from the report
rather than padding it with empty rows.

## 2. Collect

For each address, Wallet Sleuth pulls an activity sample from the highest priority provider that supports its
chain, falling back down the chain on failure.

On EVM chains it reads native transfers, ERC-20 transfers and internal transactions. It reads each
dataset **twice**: newest first, for current behaviour, and oldest first, for the account's opening
transactions. That second pass is what makes the first-funding signals possible, and it is why the
transfer budget always preserves the earliest transfers even when it has to discard the middle of a
history.

On Solana it walks signatures backwards and decodes each transaction, resolving SPL token accounts to
their owning wallets so a transfer is attributed to the person, not to the token account. Where an
RPC could not decode a transaction, Wallet Sleuth falls back to net lamport balance deltas and marks those
transfers as inferred rather than exact.

Two properties are tracked per address and both end up in the report:

- **truncated**: there was more history than the budget allowed.
- **historyComplete**: the sample reaches the account's very first transaction.

### A note on EIP-7702

Since Pectra an externally owned account can carry delegated code, and explorers report those
accounts as contracts, because at the bytecode level they are. They are still wallets with a person
behind them, and they are among the most informative counterparties an analysis can have. Wallet Sleuth
detects the delegation, records it as its own fact, and does **not** classify the account as a
contract; the signals that skip contracts therefore keep working on 7702 wallets. Reports label them
`7702 account`.

`historyComplete` gates the first-funding signals. On a partial sample the earliest transfer Wallet Sleuth can
see is an artefact of the budget, not the account's opening balance, and treating it as one would
manufacture false links. Wallet Sleuth withholds the signal instead and says so.

## 3. Resolve shared counterparties

This is the stage that separates a useful answer from a noisy one.

Two addresses both paying into the same account means nothing if that account is Uniswap. It means a
great deal if that account is a personal wallet that forwards into an exchange, because exchange
deposit addresses are issued per customer.

So Wallet Sleuth takes the counterparties shared by two or more inputs, drops anything already known to be a
service (see the [labels](./providers.md#labels)), and looks up the rest: is it a contract? does it
forward into a labelled exchange? A shared counterparty that survives all of that is evidence.
Everything else is recorded in the report's hub list, so you can see exactly what was discounted and
why.

## 4. Run signals

Each of the [fourteen signals](./signals.md) is a pure function over the collected activity. A signal
emits zero or more pieces of evidence, each with:

- a **strength** in 0..1, how well this instance of the signal fired,
- the signal's **weight** in 0..1, how much this kind of evidence is worth at full strength,
- a human readable title and explanation,
- observations (amounts, timings, addresses) and explorer links for every claim.

A signal that throws is recorded as a warning and the analysis continues. One broken heuristic never
takes down a report.

## 5. Score and cluster

Evidence is combined per pair into a score from 0 to 100, and pairs above the clustering threshold are
merged with a union-find. The mechanics, and the reasoning behind them, are in [scoring](./scoring.md).

## Budgets

An analysis carries a wall-clock budget (`budgetMs`, default 120s) and a per-address transfer budget
(`maxTransfersPerAddress`, default 400). When the wall-clock budget runs out, collection stops
cleanly and the report says so rather than returning a half-finished result that looks complete.
