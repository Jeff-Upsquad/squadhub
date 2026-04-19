import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 14, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);
export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Base>
);
export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx={11} cy={11} r={7} />
    <path d="M21 21l-4.3-4.3" />
  </Base>
);
export const IconCaret = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);
export const IconChevronLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Base>
);
export const IconMore = (p: IconProps) => (
  <Base {...p}>
    <circle cx={5} cy={12} r={1.3} fill="currentColor" />
    <circle cx={12} cy={12} r={1.3} fill="currentColor" />
    <circle cx={19} cy={12} r={1.3} fill="currentColor" />
  </Base>
);
export const IconFilter = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h18M6 12h12M10 18h4" />
  </Base>
);
export const IconSort = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h13M3 12h9M3 18h5M17 4v16M17 20l4-4M17 20l-4-4" />
  </Base>
);
export const IconGrid = (p: IconProps) => (
  <Base {...p}>
    <rect x={3} y={3} width={7} height={7} />
    <rect x={14} y={3} width={7} height={7} />
    <rect x={3} y={14} width={7} height={7} />
    <rect x={14} y={14} width={7} height={7} />
  </Base>
);
export const IconCalendar = (p: IconProps) => (
  <Base {...p}>
    <rect x={3} y={5} width={18} height={16} rx={2} />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </Base>
);
export const IconLink = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
    <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
  </Base>
);
export const IconArrowUpRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17L17 7M7 7h10v10" />
  </Base>
);
export const IconPaperclip = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12.5l-9 9a5 5 0 11-7-7l10-10a3.5 3.5 0 115 5L10 19.5a2 2 0 11-3-3l8.5-8.5" />
  </Base>
);
export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
  </Base>
);
export const IconInbox = (p: IconProps) => (
  <Base {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
  </Base>
);
export const IconKeyboard = (p: IconProps) => (
  <Base {...p}>
    <rect x={2} y={6} width={20} height={12} rx={2} />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
  </Base>
);
export const IconShare = (p: IconProps) => (
  <Base {...p}>
    <circle cx={18} cy={5} r={3} />
    <circle cx={6} cy={12} r={3} />
    <circle cx={18} cy={19} r={3} />
    <path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" />
  </Base>
);
