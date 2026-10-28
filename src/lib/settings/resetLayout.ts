/**
 * Last-resort recovery: clear this browser's saved terminal settings (layout, filters, colors,
 * indicators, strategy workspaces …) and reload. Drawings and alerts kept in the browser stay —
 * they're the user's work, not settings. Account data on the server is untouched.
 */
const KEEP = new Set(['screenerix.drawings.v1', 'screenerix.alerts.v1']);
const EXTRA = ['natr_5_14'];

export function resetSavedLayout(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && ((k.startsWith('screenerix.') && !KEEP.has(k)) || EXTRA.includes(k))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage blocked: nothing saved to clear */ }
  window.location.reload();
}
