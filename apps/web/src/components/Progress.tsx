import type { JobView, ProgressPhase } from '../lib/types';

const PHASES: { id: ProgressPhase; label: string }[] = [
  { id: 'parse', label: 'parse' },
  { id: 'collect', label: 'collect' },
  { id: 'enrich', label: 'resolve' },
  { id: 'signals', label: 'signals' },
  { id: 'score', label: 'score' },
  { id: 'done', label: 'done' },
];

export function Progress({ job }: { job: JobView }) {
  const currentIndex = PHASES.findIndex((phase) => phase.id === job.progress.phase);
  const percent = Math.round(
    Math.min(1, (currentIndex + job.progress.progress) / Math.max(1, PHASES.length - 1)) * 100,
  );

  return (
    <div className="panel" role="status" aria-live="polite">
      <div className="status-line">
        <span className="dot" aria-hidden="true" />
        <strong style={{ color: 'var(--text)' }}>{job.progress.message}</strong>
        {job.progress.detail ? <span className="mono">{job.progress.detail}</span> : null}
        <span style={{ marginLeft: 'auto' }}>{percent}%</span>
      </div>
      <div className="progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="phase-track">
        {PHASES.map((phase, index) => (
          <span
            key={phase.id}
            className={index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''}
          >
            {phase.label}
          </span>
        ))}
      </div>
      <p className="hint" style={{ margin: '14px 0 0' }}>
        Braid reads history straight from public explorers and RPC endpoints. A first run against those takes
        anywhere from ten seconds to a couple of minutes depending on how busy the addresses are; repeat runs are
        served from cache.
      </p>
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="panel" aria-hidden="true">
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 72 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 260, marginTop: 16 }} />
    </div>
  );
}
