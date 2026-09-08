import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { AnalysisOptions, ChainDescriptor, ParseResult } from '../lib/types';

export interface SubmitPayload {
  addresses: string;
  chains: string[];
  options: Partial<AnalysisOptions>;
}

interface Props {
  chains: ChainDescriptor[];
  busy: boolean;
  maxAddresses: number;
  onSubmit(payload: SubmitPayload): void;
  onCancel(): void;
  initial?: SubmitPayload;
}

const EXAMPLES: { label: string; addresses: string; chains: string[]; note: string }[] = [
  {
    label: 'Two Solana exchange wallets',
    addresses: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM\n5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
    chains: ['solana'],
    note: 'Two wallets operated by the same exchange. Expect a confirmed link from a shared signer.',
  },
  {
    label: 'Two Ethereum wallets, one owner',
    addresses: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\n0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    chains: ['ethereum'],
    note: 'Both are publicly attributed to the same person. Expect shared funding sources.',
  },
];

export function AddressInput({ chains, busy, maxAddresses, onSubmit, onCancel, initial }: Props) {
  const [text, setText] = useState(initial?.addresses ?? '');
  const [selected, setSelected] = useState<string[]>(
    initial?.chains ?? chains.filter((chain) => chain.default).map((chain) => chain.slug),
  );
  const [options, setOptions] = useState<Partial<AnalysisOptions>>(
    initial?.options ?? { maxTransfersPerAddress: 400, minScore: 15, clusterThreshold: 55, lookbackDays: 0 },
  );
  const [preview, setPreview] = useState<ParseResult | undefined>();
  const [previewError, setPreviewError] = useState<string | undefined>();
  const debounce = useRef<number>();

  const lines = useMemo(() => text.split(/[\s,;]+/).filter(Boolean), [text]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    if (lines.length === 0) {
      setPreview(undefined);
      setPreviewError(undefined);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      try {
        setPreview(await api.parse(text, selected));
        setPreviewError(undefined);
      } catch (err) {
        setPreviewError((err as Error).message);
      }
    }, 350);
    return () => window.clearTimeout(debounce.current);
  }, [text, selected, lines.length]);

  const tooMany = preview ? preview.distinctInputs > maxAddresses : lines.length > maxAddresses;
  const canSubmit = !busy && lines.length >= 2 && !tooMany && (preview?.accepted.length ?? 0) >= 2;

  const toggleChain = (slug: string) => {
    setSelected((current) =>
      current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug],
    );
  };

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit({ addresses: text, chains: selected, options });
      }}
    >
      <h2>Addresses</h2>
      <p className="hint">
        One per line. EVM (<code>0x...</code>) and Solana (base58) addresses can be mixed. Prefix with a chain to
        pin one, for example <code>base:0xabc...</code>. Up to {maxAddresses} addresses per analysis.
      </p>

      <label className="sr-only" htmlFor="addresses">
        Wallet addresses, one per line
      </label>
      <textarea
        id="addresses"
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder={'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\n9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit) {
            event.preventDefault();
            onSubmit({ addresses: text, chains: selected, options });
          }
        }}
        aria-describedby="parse-preview"
      />

      <div id="parse-preview" className="chip-row" aria-live="polite">
        {previewError ? (
          <span className="chip" style={{ color: 'var(--band-confirmed)' }}>
            {previewError}
          </span>
        ) : preview ? (
          <>
            <span className="chip">
              {preview.distinctInputs} address{preview.distinctInputs === 1 ? '' : 'es'} accepted
            </span>
            <span className="chip">{preview.accepted.length} chain lookups</span>
            {preview.rejected.map((item) => (
              <span key={item.input} className="chip" style={{ color: 'var(--band-confirmed)' }} title={item.reason}>
                unrecognised: {item.input.slice(0, 16)}
              </span>
            ))}
            {tooMany ? (
              <span className="chip" style={{ color: 'var(--band-confirmed)' }}>
                over the {maxAddresses} address limit
              </span>
            ) : null}
          </>
        ) : (
          <span className="chip">paste at least two addresses</span>
        )}
      </div>

      <div className="field">
        <label id="chains-label">Chains to search</label>
        <div className="chip-row" role="group" aria-labelledby="chains-label">
          {chains.map((chain) => (
            <button
              type="button"
              key={chain.slug}
              className="chip"
              aria-pressed={selected.includes(chain.slug)}
              onClick={() => toggleChain(chain.slug)}
              title={`${chain.name}${chain.evmChainId ? ` (chain id ${chain.evmChainId})` : ''}`}
            >
              {chain.name}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          A bare EVM address is looked up on every selected EVM chain, because one key controls the same address
          everywhere. Chains with no activity are dropped from the report.
        </p>
      </div>

      <details className="advanced">
        <summary>Advanced settings</summary>
        <div className="field-row" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="depth">History depth (transfers per address)</label>
            <input
              id="depth"
              type="number"
              min={25}
              max={5000}
              step={25}
              value={options.maxTransfersPerAddress ?? 400}
              onChange={(event) =>
                setOptions((current) => ({ ...current, maxTransfersPerAddress: Number(event.target.value) }))
              }
            />
          </div>
          <div>
            <label htmlFor="lookback">Lookback (days, 0 = all)</label>
            <input
              id="lookback"
              type="number"
              min={0}
              max={3650}
              value={options.lookbackDays ?? 0}
              onChange={(event) => setOptions((current) => ({ ...current, lookbackDays: Number(event.target.value) }))}
            />
          </div>
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="minscore">Report links scoring at least</label>
            <input
              id="minscore"
              type="number"
              min={0}
              max={100}
              value={options.minScore ?? 15}
              onChange={(event) => setOptions((current) => ({ ...current, minScore: Number(event.target.value) }))}
            />
          </div>
          <div>
            <label htmlFor="cluster">Cluster addresses at</label>
            <input
              id="cluster"
              type="number"
              min={1}
              max={100}
              value={options.clusterThreshold ?? 55}
              onChange={(event) =>
                setOptions((current) => ({ ...current, clusterThreshold: Number(event.target.value) }))
              }
            />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Deeper history finds more, and costs more time against the public endpoints Braid uses by default.
        </p>
      </details>

      <div className="btn-row" style={{ marginTop: 18 }}>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {busy ? 'Analysing...' : 'Analyse linkage'}
        </button>
        {busy ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <span className="hint" style={{ margin: 0 }}>
          {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Enter
        </span>
      </div>

      <div className="field">
        <label>Try an example</label>
        <div className="chip-row">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              className="chip"
              title={example.note}
              onClick={() => {
                setText(example.addresses);
                setSelected(example.chains);
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
