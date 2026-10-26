import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon (iOS): the Screenerix mark on the dark tile, like `icon.svg`. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0C0E' }}>
        <svg width="138" height="138" viewBox="157 155 940 940">
          <g fill="#EDEEF0" stroke="#EDEEF0" strokeWidth="22" strokeLinejoin="round">
            <path d="M402 578 509 634 509 940 402 884Z" />
            <path d="M572 408 682 466 682 846 572 788Z" />
            <path d="M746 310 852 366 852 680 746 624Z" fill="#30A46C" stroke="#30A46C" />
          </g>
        </svg>
      </div>
    ),
    size,
  );
}
