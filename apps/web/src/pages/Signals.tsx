import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SignalDoc } from '../lib/types';

const CATEGORY_COPY: Record<string, string> = {
  control: 'Evidence that one key can act for both addresses. The strongest class Braid has.',
  funding: 'Evidence about where an address got its money, especially its first money.',
  flow: 'Evidence from value moving between the addresses or into the same place.',
  coactivity: 'Evidence from the company an address keeps.',
  behavioral: 'Evidence from habits. Suggestive on its own, useful as corroboration.',
};

/** The signal catalogue, read live from the running engine rather than transcribed into a page. */
export function Signals() {
  const [signals, setSignals] = useState<SignalDoc[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    document.title = 'Signals - Braid';
    void api
      .signals()
      .then((result) => setSignals(result.signals))
      .catch((err) => setError((err as Error).message));
  }, []);

  const categories = [...new Set(signals.map((signal) => signal.category))];

  return (
    <>
      <header className="hero">
        <h1>What Braid looks for</h1>
        <p>
          Fourteen signals, each with a weight that reflects how hard it is to produce by accident. This page is
          generated from the running engine, so it always describes the version you are using.
        </p>
      </header>

      {error ? (
        <div className="callout callout-error">Could not load the signal catalogue: {error}</div>
      ) : null}

      {signals.length === 0 && !error ? (
        <div className="panel">
          <div className="skeleton" style={{ height: 400 }} />
        </div>
      ) : null}

      {categories.map((category) => (
        <section className="panel" key={category}>
          <h2>{category}</h2>
          <p className="hint">{CATEGORY_COPY[category]}</p>
          {signals
            .filter((signal) => signal.category === category)
            .sort((a, b) => b.weight - a.weight)
            .map((signal) => (
              <div className="evidence" key={signal.id} style={{ marginTop: 18 }}>
                <h4>
                  {signal.title}
                  <span className="weight">
                    {signal.id} · weight {signal.weight.toFixed(2)} · {signal.namespaces.join(' + ')}
                  </span>
                </h4>
                <p>{signal.description}</p>
              </div>
            ))}
        </section>
      ))}
    </>
  );
}
