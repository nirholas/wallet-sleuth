import { useState } from 'react';
import { api } from '../lib/api';
import { amount, bandClass, duration, labelKey, splitKey, usd, when } from '../lib/format';
import type { AnalysisReport, ChainDescriptor, Evidence, LinkEdge } from '../lib/types';
import { FlowGraph } from './FlowGraph';
import { Graph } from './Graph';

const BAND_MEANING: Record<string, string> = {
  confirmed: 'On-chain state or a signature ties these addresses together. This is not an inference.',
  strong: 'Several independent behaviours line up. Common control is the simplest explanation.',
  moderate: 'Real evidence, with an innocent explanation available. Worth investigating further.',
  weak: 'Circumstantial. Do not act on this alone.',
  none: 'Nothing beyond what unrelated addresses share.',
};

export function Report({ report, chains = [] }: { report: AnalysisReport; chains?: ChainDescriptor[] }) {
  const [selectedEdge, setSelectedEdge] = useState<string | undefined>();
  // Flow leads, because value and direction are facts off the chain, while a linkage score is an
  // inference layered on top of them. A reader should meet the evidence before the conclusion.
  const [view, setView] = useState<'flow' | 'linkage'>('flow');
  // Native symbols come from the running engine's chain registry rather than a copy in the client,
  // so adding a chain in one place is enough.
  const nativeSymbol = (chain: string) => chains.find((entry) => entry.slug === chain)?.nativeSymbol ?? '';

  return (
    <>
      <section className="panel">
        <h2>Result</h2>
        <div className="stats">
          <div className="stat">
            <b>{report.summary.addresses}</b>
            <span>addresses</span>
          </div>
          <div className="stat">
            <b style={{ color: report.edges.length > 0 ? 'var(--accent)' : 'var(--text-faint)' }}>
              {report.edges.length}
            </b>
            <span>links found</span>
          </div>
          <div className="stat">
            <b>{report.clusters.length}</b>
            <span>clusters</span>
          </div>
          <div className="stat">
            <b>{report.summary.strongestScore}</b>
            <span>strongest score</span>
          </div>
          <div className="stat">
            <b>{report.summary.transfersAnalyzed.toLocaleString()}</b>
            <span>transfers read</span>
          </div>
          <div className="stat">
            <b>{usd(report.flow.totalUsd)}</b>
            <span>value traced</span>
          </div>
          <div className="stat">
            <b>{duration(report.durationMs)}</b>
            <span>analysis time</span>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="view-tabs" role="tablist" aria-label="Graph view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'flow'}
              className={view === 'flow' ? 'active' : ''}
              onClick={() => setView('flow')}
            >
              Value flow
              <span>{usd(report.flow.totalUsd)} moved</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'linkage'}
              className={view === 'linkage' ? 'active' : ''}
              onClick={() => setView('linkage')}
            >
              Linkage
              <span>
                {report.edges.length} link{report.edges.length === 1 ? '' : 's'}
              </span>
            </button>
          </div>
          {view === 'flow' ? (
            <FlowGraph report={report} />
          ) : report.edges.length > 0 ? (
            <Graph report={report} selected={selectedEdge} onSelect={setSelectedEdge} />
          ) : (
            <div className="empty">
              <h3>No links above the reporting threshold</h3>
              <p>There is nothing to draw here, but the value flow view still shows where the money went.</p>
            </div>
          )}
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <a className="btn" href={api.exportUrl(report.id, 'edges.csv')}>
            Links CSV
          </a>
          <a className="btn" href={api.exportUrl(report.id, 'accounts.csv')}>
            Addresses CSV
          </a>
          <a className="btn" href={api.exportUrl(report.id, 'graphml')}>
            GraphML
          </a>
          <a className="btn" href={api.exportUrl(report.id, 'json')}>
            Full JSON
          </a>
        </div>
      </section>

      {report.warnings.length > 0 || report.rejected.length > 0 ? (
        <section className="panel">
          <h2>Read this before you act on it</h2>
          {report.rejected.length > 0 ? (
            <div className="callout callout-error">
              <strong>Some input was not usable.</strong>
              <ul>
                {report.rejected.map((item) => (
                  <li key={item.input}>
                    <code>{item.input}</code>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.warnings.length > 0 ? (
            <div className="callout callout-warn">
              <ul style={{ margin: 0 }}>
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>Links</h2>
        {report.edges.length === 0 ? (
          <div className="empty">
            <h3>No links above the reporting threshold</h3>
            <p>
              Nothing in the history Wallet Sleuth read connects these addresses beyond what unrelated wallets share.
              That is a real result, not a failure: lower the reporting threshold or raise the history depth in
              advanced settings to look harder, and check the caveats above for coverage gaps.
            </p>
          </div>
        ) : (
          <>
            <p className="hint">
              Every link is scored from independent signals. Open one to see the transactions behind it.
            </p>
            {report.edges.map((edge) => (
              <EdgeCard
                key={`${edge.a}|${edge.b}`}
                edge={edge}
                open={selectedEdge === `${edge.a}|${edge.b}`}
                onToggle={(open) => setSelectedEdge(open ? `${edge.a}|${edge.b}` : undefined)}
              />
            ))}
          </>
        )}
      </section>

      {report.clusters.length > 0 ? (
        <section className="panel">
          <h2>Clusters</h2>
          <p className="hint">
            Addresses merged at a score of {report.options.clusterThreshold} or above. Membership is transitive:
            two addresses can share a cluster without linking to each other directly.
          </p>
          {report.clusters.map((cluster) => (
            <div key={cluster.id} className="cluster" style={{ padding: '12px 14px' }}>
              <strong>{cluster.id}</strong>
              <span className="hint" style={{ marginLeft: 10 }}>
                cohesion {cluster.cohesion} · weakest link {cluster.weakestLink} · {cluster.chains.join(', ')}
              </span>
              <p style={{ margin: '6px 0 8px', color: 'var(--text-muted)', fontSize: 13.5 }}>{cluster.rationale}</p>
              <div className="chip-row" style={{ margin: 0 }}>
                {cluster.members.map((member) => (
                  <span key={member} className="chip mono">
                    {labelKey(member)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <h2>Addresses analysed</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Chain</th>
                <th>Cluster</th>
                <th>Transfers</th>
                <th>In / Out</th>
                <th>Counterparties</th>
                <th>Active</th>
                <th>Coverage</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((account) => (
                <tr key={account.key}>
                  <td className="mono">
                    <a href={account.explorerUrl} target="_blank" rel="noreferrer noopener">
                      {splitKey(account.key).address.slice(0, 10)}...{account.address.slice(-6)}
                    </a>
                  </td>
                  <td>{account.chain}</td>
                  <td>{account.cluster ?? '-'}</td>
                  <td>{account.transfersAnalyzed}</td>
                  <td>
                    <span className="flow">
                      <span className="tone-in" title="transfers received">
                        <span className="arrow">+</span>
                        {account.inbound}
                      </span>
                      <span className="tone-out" title="transfers sent">
                        <span className="arrow">-</span>
                        {account.outbound}
                      </span>
                    </span>
                  </td>
                  <td>{account.counterparties}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {when(account.firstActivity)} to {when(account.lastActivity)}
                  </td>
                  <td className={account.unreadable ? 'tone-out' : undefined}>
                    {account.unreadable ? 'unread' : account.historyComplete ? 'full history' : 'sample'}
                  </td>
                  <td>
                    <div className="chip-row" style={{ margin: 0, alignItems: 'center' }}>
                      {account.label ? <span className="chip">{account.label.name}</span> : null}
                      {account.isContract ? <span className="chip">contract</span> : null}
                      {account.delegated ? (
                        <span
                          className="chip"
                          title="EIP-7702 delegated account: an externally owned account with code, not a contract"
                        >
                          7702 account
                        </span>
                      ) : null}
                      {account.unreadable ? (
                        <span className="chip tone-out" title={account.warnings.join(' ')}>
                          no provider could serve this history
                        </span>
                      ) : null}
                      {account.balance !== undefined ? (
                        <span className="hint" style={{ margin: 0 }} title="Native balance">
                          {amount(account.balance)} {nativeSymbol(account.chain)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>How this result was produced</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Chain</th>
                <th>Requests</th>
                <th>Failed</th>
                <th>Upstream time</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {report.providers.map((provider) => (
                <tr key={`${provider.provider}-${provider.chain}`}>
                  <td>{provider.provider}</td>
                  <td>{provider.chain}</td>
                  <td>{provider.requests}</td>
                  <td style={{ color: provider.errors > 0 ? 'var(--band-moderate)' : 'inherit' }}>
                    {provider.errors}
                  </td>
                  <td>{duration(provider.ms)}</td>
                  <td className="hint" style={{ margin: 0 }}>
                    {provider.note ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.hubs.length > 0 ? (
          <>
            <p className="hint" style={{ marginTop: 16 }}>
              Ignored as hubs, because everyone touches them and co-occurrence there proves nothing:
            </p>
            <div className="chip-row">
              {report.hubs.slice(0, 12).map((hub) => (
                <span key={`${hub.chain}:${hub.address}`} className="chip" title={hub.reason}>
                  {hub.label?.name ?? `${hub.address.slice(0, 10)}...`}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function EdgeCard({ edge, open, onToggle }: { edge: LinkEdge; open: boolean; onToggle(open: boolean): void }) {
  return (
    <details
      className={`edge${open ? ' selected' : ''}`}
      open={open}
      onToggle={(event) => onToggle((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className={`score band-${edge.band}`} style={{ color: `var(--band-${edge.band})` }}>
          {edge.score}
        </span>
        <span>
          <span className="edge-pair">
            <span>{labelKey(edge.a)}</span>
            <span className="sep">&#8596;</span>
            <span>{labelKey(edge.b)}</span>
            {edge.crossChain ? <span className="chip">cross chain</span> : null}
          </span>
          <span className="edge-signals">{edge.signals.join(', ')}</span>
        </span>
        <span className={bandClass(edge.band)}>{edge.band}</span>
      </summary>
      <div className="edge-body">
        <p className="hint" style={{ margin: '12px 0 0' }}>
          {BAND_MEANING[edge.band]}
        </p>
        {edge.evidence.map((item, index) => (
          <EvidenceBlock key={`${item.signal}-${index}`} evidence={item} />
        ))}
      </div>
    </details>
  );
}

function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  return (
    <div className="evidence">
      <h4>
        {evidence.title}
        <span className="weight">
          {evidence.signal} · contributes {(evidence.confidence * 100).toFixed(0)}%
        </span>
      </h4>
      <p>{evidence.detail}</p>
      {evidence.observations.length > 0 ? (
        <div className="obs">
          {evidence.observations.map((observation) => (
            <span
              key={`${observation.label}-${observation.value}`}
              className={observation.tone ? `tone-${observation.tone}` : undefined}
            >
              <b>{observation.label}:</b>{' '}
              {observation.tone ? <span className="arrow">{observation.tone === 'in' ? '+' : '-'}</span> : null}
              {observation.value}
            </span>
          ))}
        </div>
      ) : null}
      {evidence.references.length > 0 ? (
        <div className="refs">
          {evidence.references.map((reference) => (
            <a
              key={`${reference.label}-${reference.value}`}
              href={reference.url ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
              className={reference.tone ? `tone-${reference.tone}` : undefined}
              title={reference.tone === 'out' ? 'value sent' : reference.tone === 'in' ? 'value received' : undefined}
            >
              {reference.tone ? <span className="arrow">{reference.tone === 'in' ? '+' : '-'}</span> : null}
              {reference.label} &#8599;
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
