import type { CSSProperties, ReactNode } from 'react';

export default function FeatureCard({ icon, title, body, delay = 0 }: { icon: ReactNode; title: string; body: string; delay?: number }) {
  return (
    <article className="lx-glass lx-feature" data-reveal data-feature style={{ '--d': delay } as CSSProperties}>
      <span className="lx-feature-icon">{icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: 17 }}>{title}</h3>
        <p className="lx-muted" style={{ fontSize: 14 }}>{body}</p>
      </div>
    </article>
  );
}
