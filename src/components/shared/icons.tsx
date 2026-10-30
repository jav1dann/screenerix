import type { ReactNode } from 'react';
import { COLORS } from '@/lib/theme';

export function Icon({ children, size = 14, stroke = 'currentColor' }: { children: ReactNode; size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      {children}
    </svg>
  );
}

export const IconArrow = () => <Icon size={16}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>;
export const IconArrowLeft = () => <Icon><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Icon>;
export const IconCheck = () => <Icon size={16} stroke={COLORS.up}><path d="M20 6 9 17l-5-5" /></Icon>;
export const IconX = () => <Icon size={16}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const IconChevron = () => <Icon><path d="m6 9 6 6 6-6" /></Icon>;
export const IconBell = () => <Icon><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></Icon>;
export const IconSearch = () => <Icon size={13} stroke={COLORS.muted}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Icon>;
export const IconCopy = () => <Icon><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Icon>;
export const IconTick = () => <Icon><path d="M20 6 9 17l-5-5" /></Icon>;
export const IconPin = ({ filled = false }: { filled?: boolean }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
    <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);
export const IconExternal = () => <Icon><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Icon>;
export const IconChartLine = () => <Icon><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></Icon>;
export const IconTerminal = () => <Icon><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></Icon>;
export const IconGear = () => (
  <Icon><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const IconPencil = () => <Icon size={12}><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" /><path d="m15 5 4 4" /></Icon>;
export const IconTrash = () => <Icon size={12}><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></Icon>;
export const IconAlarm = () => <Icon size={12}><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></Icon>;

export const IconPanel =({ open }: { open: boolean }) => (
  <Icon><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />{open ? <path d="m16 15-3-3 3-3" /> : <path d="m14 9 3 3-3 3" />}</Icon>
);

/* Landing feature icons (20px). */
export const IconGrid = () => <Icon size={20}><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /><rect width="7" height="7" x="14" y="14" rx="1.5" /></Icon>;
export const IconScan = () => <Icon size={20}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /><path d="M7 8h6" /><path d="M7 16h8" /></Icon>;
export const IconLayers = () => <Icon size={20}><path d="M4 6h10" /><path d="M4 10h16" /><path d="M4 14h7" /><path d="M4 18h13" /></Icon>;
export const IconFilter = () => <Icon size={20}><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></Icon>;
export const IconListExport = () => <Icon size={20}><path d="M3 6h11" /><path d="M3 12h7" /><path d="M3 18h7" /><path d="M17 10v10" /><path d="m13 16 4 4 4-4" /></Icon>;
export const IconBolt = () => <Icon size={20}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Icon>;
export const IconMail = () => <Icon size={20}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></Icon>;
export const IconSend = () => <Icon size={20}><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></Icon>;
export const IconGlobe = () => <Icon><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z" /></Icon>;
