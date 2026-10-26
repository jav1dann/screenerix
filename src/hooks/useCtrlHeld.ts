'use client';

import { useEffect, useState } from 'react';

/** True while the Ctrl key is held (temporary magnet on charts). Cleared when the window loses focus. */
export function useCtrlHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Control') setHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Control') setHeld(false); };
    const reset = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return held;
}
