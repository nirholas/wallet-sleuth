/**
 * The documentation set, compiled into the client.
 *
 * The markdown under `/docs` is the single source of truth: it is what a reader gets on GitHub and
 * what the site renders, so the two can never drift apart.
 */
const modules = import.meta.glob('../../../../docs/*.md', { query: '?raw', import: 'default', eager: true });

export interface DocPage {
  slug: string;
  title: string;
  body: string;
}

/** Order the docs are listed in. Anything not named here is appended alphabetically. */
const ORDER = [
  'start-here',
  'how-it-works',
  'signals',
  'scoring',
  'interpreting-results',
  'api',
  'cli',
  'self-hosting',
  'providers',
  'privacy-and-ethics',
  'faq',
];

function titleOf(markdown: string, slug: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim() ?? slug.replace(/-/g, ' ');
}

export const docs: DocPage[] = Object.entries(modules)
  .map(([path, body]) => {
    const slug = (path.split('/').pop() ?? '').replace(/\.md$/, '');
    return { slug, title: titleOf(body as string, slug), body: body as string };
  })
  .sort((a, b) => {
    const ai = ORDER.indexOf(a.slug);
    const bi = ORDER.indexOf(b.slug);
    if (ai === -1 && bi === -1) return a.slug.localeCompare(b.slug);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

export function findDoc(slug: string): DocPage | undefined {
  return docs.find((doc) => doc.slug === slug);
}
