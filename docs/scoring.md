# Scoring

A score is a number between 0 and 100 attached to a pair of addresses. It is not a probability that
the addresses share an owner, and Wallet Sleuth does not claim it is. It is a calibrated summary of how much
independent evidence there is, on a scale where the bands mean something specific.

## From evidence to a score

Each piece of evidence carries a **confidence**, which is simply `weight x strength`:

- **weight** is a property of the signal. It answers: if this signal fires perfectly, how much does
  that tell us? Reading an SPL token account's owner off chain state is worth 1.00. Noticing two
  wallets are active in the same hours is worth 0.15.
- **strength** is a property of the instance. It answers: how well did it actually fire? A single
  dust transfer and forty reciprocal transfers are the same signal at very different strengths.

Confidences then combine in two steps.

### Step one: within a signal

Three shared counterparties are stronger evidence than one, but not three times stronger. They are
three observations of the same underlying behaviour and they share the same failure mode: if the
reason is innocent, it is innocent for all three. So repeats within one signal are sorted by
confidence and each subsequent one is halved before combining:

```
c_signal = 1 - PRODUCT over i of (1 - c_i * 0.5^i)
```

This is what keeps one noisy signal from saturating a score by repetition.

### Step two: across signals

Different signals fail for different reasons, so they are treated as independent and combined with a
noisy-OR:

```
score = 100 * (1 - PRODUCT over signals of (1 - c_signal))
```

Noisy-OR is the right shape for "any one of these being true implies a link": each additional signal
closes part of the remaining doubt, and no amount of weak evidence ever reaches certainty. Two
signals at 0.5 produce 75, not 100. Ten signals at 0.15 produce 80, not 150.

## Bands

| Band | Score | What it means |
| --- | --- | --- |
| Confirmed | 85+ | On-chain state or a signature ties the addresses together. Not an inference. |
| Strong | 65 to 84 | Several independent behaviours line up. Common control is the simplest explanation. |
| Moderate | 40 to 64 | Real evidence with an innocent explanation available. Worth investigating further. |
| Weak | 20 to 39 | Circumstantial. Do not act on this alone. |
| None | below 20 | Nothing beyond what unrelated addresses share. |

Only **confirmed** rests on something other than inference, and only two signals can produce it on
their own: Solana account ownership, and one address deploying the other. Everything else has to
accumulate.

## Thresholds you control

| Option | Default | Effect |
| --- | --- | --- |
| `minScore` | 15 | Pairs below this are omitted from the report entirely. |
| `clusterThreshold` | 55 | Pairs at or above this merge into one cluster. |
| `hubShareThreshold` | 8 | A counterparty touched by this many inputs is treated as a hub. |

Lower `minScore` to see the long tail, including the weak evidence Wallet Sleuth would normally not bother
you with. Raise `clusterThreshold` when you would rather have several small confident clusters than
one large chained one.

## Clustering is transitive, on purpose

If A links to B above the threshold and B links to C above the threshold, all three land in one
cluster even when A and C never interacted. That is the correct reading when the linking evidence is
about control, and it is why the clustering threshold sits well above the reporting threshold.

The risk is a chain of merely-adequate links producing a large cluster nobody would defend. Wallet Sleuth
makes that visible rather than hiding it: every cluster reports its **weakest link**, the lowest
scoring edge holding it together. If a nine-address cluster has a weakest link of 56, you are looking
at a chain, and you should say so.

## What the score is not

It is not a probability, it is not admissible on its own, and it is not stable across analyses with
different budgets: reading more history can only add evidence, so a deeper pass may score higher. The
report always states how much history it read. Compare scores between addresses in one report, not
between reports run with different settings.
