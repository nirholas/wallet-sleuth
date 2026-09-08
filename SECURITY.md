# Security policy

## Reporting a vulnerability

Report security issues privately through GitHub's [private vulnerability
reporting](https://github.com/nirholas/wallet-sleuth/security/advisories/new). Please do not open a public
issue for anything exploitable.

Include what you did, what happened, and what you expected. A proof of concept is welcome. Expect an
acknowledgement within three working days and a fix or a plan within fourteen.

## What counts as a vulnerability here

The obvious ones: remote code execution, SSRF through a configurable provider URL, injection into an
export format, authentication bypass on `/v1`, denial of service that a single request can cause.

And one that is specific to this project: **a way to make Wallet Sleuth produce a confidently wrong result**.
False confidence is the harm this tool is capable of causing. If you can construct on-chain activity
that pushes an unrelated pair of addresses into the strong or confirmed band for less than it would
cost to do so honestly, that is a security issue, not a feature request. Address poisoning is the
known example and is already discounted; new ones are worth reporting.

## Out of scope

- Rate limits or availability of the third-party public endpoints Wallet Sleuth reads from.
- Results you disagree with that are supported by the evidence shown. Open an issue instead.
- Vulnerabilities in a deployment's own infrastructure. Wallet Sleuth is a program you run; securing the host,
  the TLS termination and the API keys is the operator's responsibility. See
  [docs/self-hosting.md](docs/self-hosting.md).

## Operating Wallet Sleuth safely

Wallet Sleuth stores nothing on disk and holds analyses in memory for one hour by default. The addresses
somebody asks about are themselves sensitive; if you run a public instance, set `SLEUTH_API_KEYS`,
keep the rate limits on, and decide deliberately what your logs retain.
