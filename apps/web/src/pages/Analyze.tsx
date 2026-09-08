import { useCallback, useEffect, useRef, useState } from 'react';
import { AddressInput, type SubmitPayload } from '../components/AddressInput';
import { Progress, ReportSkeleton } from '../components/Progress';
import { Report } from '../components/Report';
import { api, followJob, type JobStream } from '../lib/api';
import type { AnalysisReport, ChainDescriptor, JobView } from '../lib/types';

export function Analyze() {
  const [chains, setChains] = useState<ChainDescriptor[]>([]);
  const [maxAddresses, setMaxAddresses] = useState(50);
  const [job, setJob] = useState<JobView | undefined>();
  const [report, setReport] = useState<AnalysisReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [bootError, setBootError] = useState<string | undefined>();
  const stream = useRef<JobStream>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [chainList, version] = await Promise.all([api.chains(), api.version()]);
        if (cancelled) return;
        setChains(chainList.chains);
        setMaxAddresses(version.maxAddresses);
      } catch (err) {
        if (!cancelled) setBootError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stream.current?.close();
    };
  }, []);

  const submit = useCallback(async (payload: SubmitPayload) => {
    stream.current?.close();
    setError(undefined);
    setReport(undefined);
    try {
      const created = await api.analyze({
        addresses: payload.addresses,
        chains: payload.chains,
        options: payload.options,
      });
      setJob(created);
      stream.current = followJob(created.id, {
        onStatus: setJob,
        onReport: (result) => {
          setReport(result);
          setJob((current) => (current ? { ...current, status: 'done' } : current));
        },
        onError: setError,
      });
    } catch (err) {
      setError((err as Error).message);
      setJob(undefined);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!job) return;
    stream.current?.close();
    try {
      await api.cancel(job.id);
    } catch {
      /* cancelling a job that already finished is not an error worth surfacing */
    }
    setJob(undefined);
  }, [job]);

  const busy = Boolean(job && (job.status === 'queued' || job.status === 'running') && !report);

  return (
    <>
      <header className="hero">
        <h1>
          Are these wallets <span className="accent">the same person?</span>
        </h1>
        <p>
          Paste public addresses from Ethereum, Base, Arbitrum, OP, Polygon or Solana. Braid reads their real
          on-chain history, looks for the fourteen ways addresses give each other away, and shows you the
          transactions behind every link it finds. No account, no API key, nothing stored.
        </p>
      </header>

      {bootError ? (
        <div className="callout callout-error">
          <strong>The Braid API is not reachable.</strong> {bootError}
        </div>
      ) : null}

      <div className="grid-2">
        <div>
          {chains.length > 0 ? (
            <AddressInput
              chains={chains}
              busy={busy}
              maxAddresses={maxAddresses}
              onSubmit={submit}
              onCancel={cancel}
            />
          ) : (
            <div className="panel">
              <div className="skeleton" style={{ height: 320 }} />
            </div>
          )}
        </div>

        <div>
          {error ? (
            <div className="callout callout-error">
              <strong>Analysis failed.</strong> {error}
            </div>
          ) : null}

          {busy && job ? <Progress job={job} /> : null}
          {busy ? <ReportSkeleton /> : null}
          {report ? <Report report={report} /> : null}

          {!busy && !report && !error ? (
            <div className="panel">
              <div className="empty">
                <h3>Nothing analysed yet</h3>
                <p>
                  Add two or more addresses on the left and run an analysis. Results appear here with a graph, a
                  scored link for every pair, and the exact transactions that produced each score.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
