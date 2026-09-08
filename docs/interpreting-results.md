# Interpreting results

A linkage tool is only as good as the discipline of the person reading it. This page is about that.

## Read the caveats first

Every report has a caveats section, and it is not boilerplate. It tells you:

- whether the history Braid read was **complete or a sample**,
- whether the **time budget** ran out mid-collection,
- whether any input address is a **known service**, in which case links to it describe the service
  and its customers rather than one person,
- which **signals were withheld** for lack of data, particularly the first-funding signals,
- whether any **provider disagreed with another** about how much history exists.

A strong score computed over 40 transfers of a 200,000 transfer wallet is a strong score about 40
transfers.

## What each band licenses you to say

**Confirmed (85+).** You can state the relationship as fact, in the specific terms the evidence
gives. "This token account is owned by that wallet" is a fact. "The same person owns both" is still
an inference, because a custodian owns token accounts on behalf of users.

**Strong (65 to 84).** You can say the addresses are very likely operated together, and you should
name the evidence when you say it. This is the band where investigation normally continues rather
than concludes.

**Moderate (40 to 64).** You have a lead. State it as a lead. There is an innocent explanation
available for everything in this band, and the report usually names it.

**Weak (20 to 39).** Useful for ranking which pair to look at next. Nothing more.

## The failure modes worth knowing

**Address poisoning.** Anyone can send you a dust transfer. Attackers do this at scale specifically
to create edges in clustering tools. Braid discounts dust-only contact heavily and says so in the
evidence, but if a `direct-transfer` link is the only thing holding a pair together and the amount is
tiny, treat it as noise.

**Shared services that are not labelled.** Braid's label set covers the major exchanges, bridges,
routers and programs, and it detects contracts and high-degree hubs automatically. It will not
recognise every small service. A shared counterparty that turns out to be an obscure launchpad
produces a `common-funder` or `common-payee` link that means nothing. Check the shared account in the
evidence before you rely on it.

**Airdrops, payroll and batch distributions.** These produce exactly the shape of `funding-burst`:
one funder, many recipients, similar amounts, close in time. Braid scales the score down by how many
of the analysed addresses the funder touches, which helps, but if you feed it ten addresses from the
same airdrop it will find them related, and in a sense they are: related by that airdrop, not by
ownership.

**Custodial accounts.** An exchange signs for millions of users. The `solana-fee-payer` signal
discounts payers that appear across many inputs and ignores labelled services, but a small custodian
that Braid does not know about will look like shared control, because at the level of the chain it
*is* shared control. It is just not shared ownership.

**Cross-chain matching is correlation.** The `cross-chain-stable` signal matches a stablecoin amount
leaving one chain against a near identical amount arriving on another. Amounts are comparable across
chains because a dollar is a dollar. That is what makes it checkable, and it is still a coincidence
risk on a busy route. Round numbers are discounted for exactly this reason.

**Contracts and 7702 accounts are not the same thing.** Braid excludes contracts from the shared
counterparty signals, because anyone can call a contract. An EIP-7702 delegated account also has
code, but it is a wallet, so it is kept. If you are reading raw explorer output alongside a Braid
report and the two disagree about whether something is a contract, this is usually why.

## When Braid finds nothing

An empty result is a real finding, not a failure. It means: in the history that was read, with the
signals that ran, nothing connects these addresses beyond what unrelated wallets share.

Before concluding that, check three things: did the history budget truncate the sample, did the time
budget expire, and are the addresses active enough to have a history at all. All three are in the
report.

## Do not use this to

Deanonymise people, harass people, or make consequential decisions about a person from a score alone.
Braid reads public data and reports patterns in it. The gap between "these addresses behave as one
operator" and "this person did that thing" is not one a tool can close, and pretending otherwise is
how tools like this cause harm. See [privacy and ethics](./privacy-and-ethics.md).
