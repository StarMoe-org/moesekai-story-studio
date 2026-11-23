import React from "react";

export interface StudioLogoProps {
    size?: number;
    className?: string;
    title?: string;
}

/**
 * MoeSekai Story Studio canonical flat vector brand mark (Branching Star).
 * Pure geometric flat SVG — zero gradients, zero drop shadows, 3 solid brand colors.
 */
export const StudioLogo: React.FC<StudioLogoProps> = ({
    size = 24,
    className,
    title,
}) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        width={size}
        height={size}
        className={className}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        data-testid="studio-logo"
    >
        <path
            d="M 160 0 L 352 0 C 414 0 446 0 479 33 C 512 66 512 98 512 160 L 512 352 C 512 414 512 446 479 479 C 446 512 414 512 352 512 L 160 512 C 98 512 66 512 33 479 C 0 446 0 414 0 352 L 0 160 C 0 98 0 66 33 33 C 66 0 98 0 160 0 Z"
            fill="#116B65"
        />
        <path
            d="M 250 256 C 296 256 296 156 346 156 L 374 156"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M 250 256 C 296 256 296 356 346 356 L 374 356"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <circle cx="374" cy="156" r="46" fill="#FFFFFF" />
        <circle cx="374" cy="156" r="18" fill="#5EEAD4" />
        <circle cx="374" cy="356" r="46" fill="#FFFFFF" />
        <circle cx="374" cy="356" r="18" fill="#116B65" />
        <path
            d="M 146 174 C 156 228 174 246 228 256 C 174 266 156 284 146 338 C 136 284 118 266 64 256 C 118 246 136 228 146 174 Z"
            fill="#5EEAD4"
        />
    </svg>
);
