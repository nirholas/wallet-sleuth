/**
 * The mark: a linkage graph seen through a lens.
 *
 * The three nodes and their edges are the thing being examined, the lens is the examining. It reads
 * at 16 pixels in a browser tab, which is the only size that really has to work.
 */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g stroke="var(--line-strong)" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M8 21 L15 12 L24 17" />
        <path d="M8 21 L24 17" />
      </g>
      <circle cx="8" cy="21" r="2.4" fill="var(--violet)" />
      <circle cx="24" cy="17" r="2.4" fill="var(--pink)" />
      <circle cx="15" cy="12" r="2.4" fill="var(--accent)" />
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="14" cy="14" r="7.5" />
        <path d="M19.6 19.6 L26 26" />
      </g>
    </svg>
  );
}
