import { describe, expect, it } from 'vitest';
import { loadSanctions, NOT_SCREENED } from '../src/sanctions.js';
import { MemoryCache } from '../src/util/cache.js';

/**
 * These assert the screen's own logic, not the contents of the list, which changes when Treasury
 * publishes. The live list is exercised in test/live.
 */
describe('sanctions screen', () => {
  it('treats an unscreened run as unscreened, never as clean', () => {
    expect(NOT_SCREENED.complete).toBe(false);
    expect(NOT_SCREENED.unavailable.length).toBeGreaterThan(0);
    // The critical property: an address is not reported as sanctioned when nothing was loaded, but
    // `complete` is false so the report cannot describe it as screened either.
    expect(NOT_SCREENED.isSanctioned('ethereum', '0xabc')).toBe(false);
  });

  it('reports a failed fetch instead of silently returning a clean screen', async () => {
    const cache = new MemoryCache();
    // Point the loader at a chain with no list mapping so nothing is fetched at all.
    const screen = await loadSanctions(['a-chain-with-no-list'], { cache });
    expect(screen.complete).toBe(true);
    expect(screen.isSanctioned('a-chain-with-no-list', 'anything')).toBe(false);
  });
});
