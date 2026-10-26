import { BTN_RESET } from '@/components/chart/styles';

/** A filter's Mode toggle (enabled / disabled). */
export default function ModeSwitch({ checked, onChange, label, showLabel = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; showLabel?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={showLabel ? undefined : label}
      onClick={() => onChange(!checked)}
      className={`${BTN_RESET} inline-flex h-[34px] items-center gap-2.5 self-start rounded-lg text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-sx-up`}
    >
      <span className={`flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-sx-up' : 'justify-start bg-sx-line2'}`}>
        <span className="h-4 w-4 rounded-full bg-white shadow" />
      </span>
      {showLabel && <span className={checked ? 'text-sx-text' : 'text-sx-muted'}>{label}</span>}
    </button>
  );
}
