import type { Band } from './types';

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

export function splitKey(key: string): { chain: string; address: string } {
  const idx = key.indexOf(':');
  return idx < 0 ? { chain: '', address: key } : { chain: key.slice(0, idx), address: key.slice(idx + 1) };
}

export function labelKey(key: string): string {
  const { chain, address } = splitKey(key);
  return chain ? `${chain}:${shortAddress(address)}` : shortAddress(address);
}

export function bandClass(band: Band): string {
  return `band band-${band}`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function when(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function amount(value?: number): string {
  if (value === undefined) return '-';
  if (value === 0) return '0';
  if (Math.abs(value) < 0.001) return value.toExponential(2);
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function copy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('clipboard unavailable'));
}
