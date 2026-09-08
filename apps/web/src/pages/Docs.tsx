import { useEffect, useMemo } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { docs, findDoc } from '../lib/docs';

marked.setOptions({ gfm: true, breaks: false });

/**
 * Renders the repository's markdown documentation.
 *
 * Relative links between the markdown files are rewritten to site routes so a reader can follow the
 * same trail on the site that they would follow on GitHub.
 */
export function Docs() {
  const { slug } = useParams();
  const active = findDoc(slug ?? 'start-here') ?? docs[0];

  useEffect(() => {
    document.title = active ? `${active.title} - Wallet Sleuth docs` : 'Wallet Sleuth docs';
    window.scrollTo({ top: 0 });
  }, [active]);

  const html = useMemo(() => {
    if (!active) return '';
    const rendered = marked.parse(active.body) as string;
    return rendered
      .replace(/href="\.\/([a-z0-9-]+)\.md"/g, 'href="/docs/$1"')
      .replace(/href="([a-z0-9-]+)\.md"/g, 'href="/docs/$1"');
  }, [active]);

  if (!active) {
    return (
      <div className="empty">
        <h3>No documentation is bundled in this build</h3>
        <p>The docs are compiled from the repository&apos;s /docs directory at build time.</p>
      </div>
    );
  }

  return (
    <div className="docs-layout">
      <nav className="docs-nav" aria-label="Documentation">
        {docs.map((doc) => (
          <NavLink key={doc.slug} to={`/docs/${doc.slug}`} end>
            {doc.title}
          </NavLink>
        ))}
        <a href="/docs/api" target="_blank" rel="noreferrer">
          API reference &#8599;
        </a>
      </nav>
      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
