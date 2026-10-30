import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';

import { DOCS, DOC_GROUPS } from '../docs/content';
import { NotFound } from './NotFound';

export function DocsPage() {
  const { slug = 'overview' } = useParams();
  const [filter, setFilter] = useState('');
  const index = DOCS.findIndex((doc) => doc.slug === slug);
  const doc = DOCS[index];

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return DOCS.filter(
      (d) => !needle || d.title.toLowerCase().includes(needle) || d.summary.toLowerCase().includes(needle),
    );
  }, [filter]);

  if (!doc) return <NotFound />;
  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];

  return (
    <div className="container docs">
      <nav className="docs-nav" aria-label="Documentation">
        <input
          className="input"
          type="search"
          placeholder="Search docs…"
          aria-label="Search the documentation"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {DOC_GROUPS.map((group) => {
          const entries = visible.filter((d) => d.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group} style={{ display: 'contents' }}>
              <h4>{group}</h4>
              {entries.map((entry) => (
                <NavLink
                  key={entry.slug}
                  to={entry.slug === 'overview' ? '/docs' : `/docs/${entry.slug}`}
                  end
                  className={() => (entry.slug === doc.slug ? 'active' : '')}
                >
                  {entry.title}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <article className="prose reveal" key={doc.slug}>
        <div className="eyebrow">{doc.group}</div>
        <h1>{doc.title}</h1>
        {doc.body()}
        <div className="pager">
          {prev ? (
            <Link to={prev.slug === 'overview' ? '/docs' : `/docs/${prev.slug}`}>
              <small>← Previous</small>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={`/docs/${next.slug}`} style={{ textAlign: 'right' }}>
              <small>Next →</small>
              {next.title}
            </Link>
          ) : null}
        </div>
      </article>
    </div>
  );
}
