'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Scroll reveal for `[data-reveal]` elements under `root`: arms the CSS (`.lx-anim`) and marks
 * each element `data-shown` the first time it scrolls into view. Without JS, or with reduced
 * motion, nothing is ever hidden.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute('data-shown', '');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    el.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
    el.classList.add('lx-anim');
    return () => {
      io.disconnect();
      el.classList.remove('lx-anim');
    };
  }, [root]);
}
