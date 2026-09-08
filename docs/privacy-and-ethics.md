# Privacy and ethics

Wallet Sleuth is a chain analysis tool. Tools like this get used to hold exchanges accountable, to trace
stolen funds back to the people who took them, and to check whether a counterparty is who they say
they are. They also get used to stalk, to dox, and to punish people for transactions that were
nobody else's business. The technology does not distinguish between those uses. The people building
and running it have to.

## What Wallet Sleuth does and does not do

**It reads public data only.** Every byte Wallet Sleuth uses is already published on a public blockchain and
served by public explorers and RPC endpoints. Wallet Sleuth does not scrape social accounts, does not buy
data, does not join addresses against off-chain identity, and has no way to tell you who a person is.

**It does not identify people.** A cluster is a set of addresses that behave as though one operator
is behind them. Turning that into a name requires information Wallet Sleuth does not have and does not want.
If you bring that information yourself, the responsibility for what you do with the combination is
entirely yours.

**It stores nothing.** Analyses run in memory and are dropped after `SLEUTH_JOB_RETENTION_MS` (one
hour by default). Addresses you submit are not logged to disk, not persisted to a database, and not
sent anywhere except to the block explorers and RPC endpoints needed to read their history. There is
no account system because there is nothing to attach to an account.

**Your queries are visible to the providers.** Wallet Sleuth asks public endpoints about specific addresses,
and those endpoints see the requests. If that matters for your use case, run Wallet Sleuth against your own
RPC and explorer infrastructure; every provider is configurable for exactly this reason.

## The asymmetry that makes this uncomfortable

Address clustering is easy and denying it is hard. A tool can accuse an address of being linked in
seconds; the person on the other end cannot produce evidence that they do not control a wallet. That
asymmetry is why Wallet Sleuth is built the way it is:

- Every score comes with **the evidence and the transaction links**, so a claim can be checked rather
  than trusted.
- Every report carries **caveats about its own coverage**, so a partial read is never presented as a
  complete one.
- Innocent explanations are **named in the evidence text**, not buried in documentation.
- Weak signals are **weighted weakly**, and behavioural signals cannot reach a strong band on their
  own no matter how many of them fire.
- Known services are **excluded from the signals that would otherwise treat everyone who used them as
  related**.

None of that makes the tool safe. It makes it auditable, which is the most a tool can do.

## Use it for

Tracing stolen funds. Due diligence on a counterparty. Auditing a protocol's own treasury and
operational wallets. Detecting sybil attacks on an airdrop or a governance vote, where the question
genuinely is "is this one person wearing many hats". Research on chain behaviour. Checking your own
operational hygiene: run your own addresses through it and see what you are leaking.

## Do not use it for

Deanonymising people who have not consented. Building or feeding a surveillance product. Harassment,
extortion, or exposing someone's finances. Making a consequential decision about a person, such as
denying them service or accusing them publicly, on the strength of a score alone.

If you operate a hosted instance, you are responsible for the queries it runs. Consider rate limits,
API keys, and a log retention policy that reflects the fact that a list of addresses somebody asked
about is itself sensitive.

## Responsible disclosure

Security issues, including ways to make Wallet Sleuth produce confidently wrong results, are welcome and
covered by [SECURITY.md](https://github.com/nirholas/wallet-sleuth/blob/main/SECURITY.md). A signal that
can be cheaply spoofed is a security issue, not just a bug: false confidence is the specific harm
this tool can cause.
