import type { ReactNode } from 'react';
import { IconBolt, IconFilter, IconGrid, IconLayers, IconListExport, IconScan } from '@/components/shared/icons';
import type { Dict } from '@/lib/landing/i18n/en';
import FeatureCard from './FeatureCard';
import { h2, sectionHead } from './styles';

/** Icons in the order of `features.items`: map, review, densities, filters & alerts, TradingView, proxy. */
const ICONS: ReactNode[] = [<IconGrid key="map" />, <IconScan key="review" />, <IconLayers key="dens" />, <IconFilter key="filters" />, <IconListExport key="tv" />, <IconBolt key="ping" />];

export default function Features({ t }: { t: Dict['features'] }) {
  return (
    <section id="features" className="lx-wrap lx-section">
      <div style={sectionHead} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
        <p className="lx-muted" style={{ fontSize: 16 }}>{t.subtitle}</p>
      </div>
      <div className="lx-feature-grid">
        {t.items.map((f, i) => <FeatureCard key={f.title} icon={ICONS[i]} title={f.title} body={f.body} delay={i % 3} />)}
      </div>
    </section>
  );
}
