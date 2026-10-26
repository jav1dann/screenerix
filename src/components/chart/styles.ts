/**
 * Shared Tailwind class strings. The app omits Tailwind's preflight, so buttons and
 * inputs reset browser defaults explicitly here.
 */
/** Reset without background / colour, for filled buttons (keeps their `bg-*` / `text-*` from competing with the reset's). */
const BTN_BASE = 'box-border m-0 cursor-pointer border-0 p-0 font-[inherit] disabled:cursor-not-allowed';
export const BTN_RESET = `${BTN_BASE} bg-transparent text-inherit`;

export const ICON_BTN = `${BTN_RESET} grid h-7 w-7 shrink-0 place-items-center rounded-md text-sx-muted transition-colors hover:bg-white/[0.06] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up disabled:opacity-40 disabled:hover:bg-transparent`;

export const PRIMARY_BTN = `${BTN_BASE} inline-flex items-center justify-center rounded-lg bg-sx-text px-4 py-2 text-[13px] font-semibold text-sx-bg transition-colors hover:bg-white disabled:opacity-40`;

export const GHOST_BTN = `${BTN_RESET} inline-flex items-center justify-center rounded-lg border border-solid border-sx-line bg-white/[0.03] px-4 py-2 text-[13px] font-semibold text-sx-text transition-colors hover:border-sx-line2 hover:bg-white/[0.07] disabled:opacity-40`;

export const INPUT = 'box-border w-full rounded-lg border border-solid border-sx-line bg-sx-bg/60 px-3 py-2 font-[inherit] text-[13px] text-sx-text outline-none transition-colors placeholder:text-[#5F626C] focus:border-sx-up';
