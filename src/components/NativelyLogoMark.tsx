import React from 'react';

/**
 * Soro X logomark — an "X" crossing a ring.
 * Rendered as inline SVG so it inherits `color` (currentColor) and
 * can be styled freely with className.
 *
 * The exact master geometry (brand/sorox-mark-*.svg): one filled
 * path (nonzero), ring + both diagonals all one width (75/1024), cropped to the ring.
 */
export const NativelyLogoMark: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="106 106 812 812"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <path
            fill="currentColor"
            d="M512 106 A406 406 0 1 1 512 918 A406 406 0 1 1 512 106 Z M512 181 A331 331 0 1 0 512 843 A331 331 0 1 0 512 181 Z M131.93 184.96 L184.96 131.93 L892.07 839.04 L839.04 892.07 Z M184.96 892.07 L131.93 839.04 L839.04 131.93 L892.07 184.96 Z"
        />
    </svg>
);
