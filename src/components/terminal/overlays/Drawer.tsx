import type { ReactNode } from 'react';
import { IconX } from '@/components/shared/icons';
import { COLORS } from '@/lib/theme';

export default function Drawer({ title, meta, onClose, children, footer }: { title: string; meta?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="sx-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sx-scrim" onClick={onClose} aria-label="Close" />
      <div className="sx-drawer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: `1px solid ${COLORS.line}` }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          {meta && <span className="sx-muted" style={{ fontSize: 12 }}>{meta}</span>}
          <button className="sx-icon-btn" onClick={onClose} style={{ marginLeft: 'auto' }} aria-label="Close"><IconX /></button>
        </div>
        {children}
        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', borderTop: `1px solid ${COLORS.line}` }}>{footer}</div>
      </div>
    </div>
  );
}
