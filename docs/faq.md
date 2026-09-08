# FAQ

**Does this tell me who owns an address?**
No. Braid reports which addresses behave as though one operator is behind them. Public chain data
does not contain identities and Braid does not try to supply them.

**Why does it take a minute?**
Because it reads real history from public endpoints that rate limit. A two-address Solana analysis is
typically 20 to 30 seconds and an Ethereum one 40 to 60 on the free endpoints. Set `ETHERSCAN_API_KEY`
and `HELIUS_API_KEY` and both drop by roughly an order of magnitude. Repeat analyses hit the cache.

**Why did it fan my one address out onto six chains?**
Because the same private key controls the same address on every EVM chain, and the linkage you are
looking for often lives on a chain you did not think to ask about. Chains with no activity are
dropped from the report. Pin a chain with a prefix (`base:0xabc...`) or the `chains` option.

**Two addresses I know are related scored low. Why?**
Usually one of three reasons, all of which the report states: the history budget truncated the sample
before the connecting transactions, the connection runs through an address Braid classified as a hub,
or the relationship is real but not visible on chain at all. Raise `maxTransfersPerAddress`, lower
`minScore` to see the weak tail, and read the hub list.

**Two addresses I know are unrelated scored high. Why?**
Check the evidence. The common causes are a shared service Braid does not have a label for, an airdrop
or payroll batch that funded both, and address poisoning dust. All three are described in
[interpreting results](./interpreting-results.md). If you find a service that should be labelled,
adding it is a one line change to `packages/core/src/labels/known-entities.json`.

**Can I add my own labels?**
Yes. Point `BRAID_LABELS_FILE` at a JSON file in the same shape as the built-in one. See
[providers](./providers.md#labels).

**Does it support Bitcoin?**
Not yet. UTXO chains need a different collection model (inputs and outputs rather than accounts) and
their own signals, chiefly common-input-ownership. The provider interface is designed to take a third
namespace.

**Is the score a probability?**
No. See [scoring](./scoring.md). It is a calibrated summary of independent evidence, and the bands
are what carry the meaning.

**Can I run it fully offline or against private infrastructure?**
Yes. Set `SOLANA_RPC_URLS` to your own nodes and `BRAID_BLOCKSCOUT_<CHAIN>` to your own explorer
instances. Braid makes no outbound requests other than to the configured providers.

**What happens to the addresses I submit?**
They are held in memory for the life of the job (one hour by default) and sent to the configured
providers to read their history. Nothing is written to disk. See
[privacy and ethics](./privacy-and-ethics.md).

**Why is there a maximum of 50 addresses?**
Pairwise analysis is quadratic and every address costs upstream requests. Fifty addresses is 1,225
pairs, which is already more than a person will read. Split larger sets, or raise `MAX_ADDRESSES` in
`packages/core/src/analyze.ts` and accept the cost.
