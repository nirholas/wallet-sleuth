export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M9 7c6 3 6 15 0 18" />
        <path d="M23 7c-6 3-6 15 0 18" />
        <path d="M16 8v16" />
      </g>
      <circle cx="9" cy="7" r="2.6" fill="var(--accent)" />
      <circle cx="23" cy="25" r="2.6" fill="var(--violet)" />
      <circle cx="16" cy="16" r="2.2" fill="var(--pink)" />
    </svg>
  );
}
