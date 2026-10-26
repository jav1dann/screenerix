import type { MetadataRoute } from 'next';

/** Web app manifest: installable terminal (Android / desktop), icons rendered from `icon.svg`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Screenerix',
    short_name: 'Screenerix',
    description: 'Real-time crypto screener & trading terminal.',
    start_url: '/terminal',
    display: 'standalone',
    background_color: '#0B0C0E',
    theme_color: '#0B0C0E',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
