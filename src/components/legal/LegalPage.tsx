import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconArrowLeft } from '@/components/shared/icons';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import { LEGAL_DOCS } from '@/lib/legal/content';
import type { LegalBlock, LegalDoc } from '@/lib/legal/content';
import { COLORS } from '@/lib/theme';

export const legalMetadata = (doc: LegalDoc): Metadata => ({
  title: `${doc.title} — Screenerix`,
  description: doc.description,
  alternates: { canonical: `/${doc.slug}` },
});

/** Highlights the [placeholders] still to be filled in. */
function withMarks(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\])/).filter(Boolean).map((p, i) => (p.startsWith('[') ? <mark key={i}>{p}</mark> : p));
}

function Block({ b }: { b: LegalBlock }) {
  if (typeof b === 'string') return <p>{withMarks(b)}</p>;
  if ('list' in b) return <ul>{b.list.map((li) => <li key={li}>{withMarks(li)}</li>)}</ul>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr>{b.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{b.table.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{i === 0 ? <code>{c}</code> : withMarks(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A static legal document: title, date, contents, sections, and links to the other policies. */
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="lx-root" lang="en">
      <header style={{ borderBottom: `1px solid ${COLORS.line}` }}>
        <div className="lx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 16, height: 64 }}>
          <Link href="/" aria-label="Screenerix home" style={{ marginRight: 'auto' }}><ScreenerixLogo size={26} fontSize={14} /></Link>
          <Link href="/" className="lx-btn lx-btn-sm"><IconArrowLeft /> Back to site</Link>
        </div>
      </header>
      <main className="lx-legal" data-legal={doc.slug}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="lx-kicker">Legal</span>
          <h1>{doc.title}</h1>
          <span className="lx-muted" style={{ fontSize: 13 }}>Last updated: {doc.updated}</span>
        </div>
        <p style={{ fontSize: 16 }}>{withMarks(doc.intro)}</p>
        <nav aria-label="Contents" className="lx-inset" style={{ padding: '14px 18px' }}>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
            {doc.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="lx-muted">{s.heading}</a></li>)}
          </ol>
        </nav>
        {doc.sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id}>
            <h2 id={s.id}>{s.heading}</h2>
            {s.body.map((b, i) => <Block key={i} b={b} />)}
          </section>
        ))}
        <nav aria-label="Other policies" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 12, borderTop: `1px solid ${COLORS.line}` }}>
          {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d) => <Link key={d.slug} href={`/${d.slug}`} className="lx-btn lx-btn-sm">{d.title}</Link>)}
        </nav>
      </main>
    </div>
  );
}
