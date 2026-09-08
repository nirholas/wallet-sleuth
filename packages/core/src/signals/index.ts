import { assetOverlap, crossChainStable, temporalProfile } from './behavioral.js';
import { evmDeployer, gasFunding, solanaAccountControl, solanaFeePayer } from './control.js';
import { commonFirstFunder, commonFunder, counterpartyOverlap, fundingBurst, peerFunding } from './funding.js';
import { commonPayee, directTransfer } from './flow.js';
import type { Signal, SignalContext } from './context.js';
import type { Evidence } from '../types.js';

/** Every signal Wallet Sleuth can run, in the order they are reported. */
export const ALL_SIGNALS: Signal[] = [
  solanaAccountControl,
  solanaFeePayer,
  peerFunding,
  evmDeployer,
  commonFirstFunder,
  directTransfer,
  gasFunding,
  fundingBurst,
  commonFunder,
  commonPayee,
  crossChainStable,
  counterpartyOverlap,
  assetOverlap,
  temporalProfile,
];

export const SIGNALS_BY_ID = new Map(ALL_SIGNALS.map((signal) => [signal.id, signal]));

/** Runs the enabled signals. A signal that throws is reported, never fatal to the analysis. */
export function runSignals(
  ctx: SignalContext,
  enabled: string[] = [],
): { evidence: Evidence[]; failures: string[] } {
  const selected = enabled.length > 0 ? ALL_SIGNALS.filter((s) => enabled.includes(s.id)) : ALL_SIGNALS;
  const evidence: Evidence[] = [];
  const failures: string[] = [];
  for (const signal of selected) {
    try {
      evidence.push(...signal.run(ctx));
    } catch (err) {
      failures.push(`signal ${signal.id} failed: ${(err as Error).message}`);
    }
  }
  return { evidence, failures };
}

export * from './context.js';
export { assetOverlap, crossChainStable, temporalProfile } from './behavioral.js';
export { evmDeployer, gasFunding, solanaAccountControl, solanaFeePayer } from './control.js';
export { commonFirstFunder, commonFunder, counterpartyOverlap, fundingBurst, peerFunding } from './funding.js';
export { commonPayee, directTransfer } from './flow.js';
