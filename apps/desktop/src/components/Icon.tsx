/**
 * Icon — crisp stroke-based SVG icon set, zero dependencies.
 *
 * Replaces emoji icons (🤖 ⚙️ 🛍️ 🌙 ☀️ etc.) throughout the UI.
 * All glyphs draw from currentColor, align to a 24px grid, and use
 * 1.75px strokes tuned for 16-20px display.
 */
import type { SVGProps } from "react";

type IconName =
  | "chat"
  | "settings"
  | "monitor"
  | "sparkle"
  | "skills"
  | "plus"
  | "search"
  | "close"
  | "sun"
  | "moon"
  | "split"
  | "single"
  | "send"
  | "stop"
  | "pause"
  | "check"
  | "alert"
  | "info"
  | "menu"
  | "trash"
  | "edit"
  | "logo"
  | "bot"
  | "users"
  | "chart"
  | "book"
  | "sliders"
  | "shield"
  | "feather"
  | "arrow-right"
  | "arrow-down"
  | "chevron-right"
  | "chevron-down"
  | "globe"
  | "file";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "stroke"> {
  name: IconName;
  size?: number | string;
  stroke?: number;
}

const PATHS: Record<IconName, React.ReactNode> = {
  chat: (
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9l-4.3 3.3a.5.5 0 0 1-.7-.46V5.5Z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2.07 2.07 0 1 1-2.93 2.93l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2.07 2.07 0 1 1-4.14 0v-.1a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2.07 2.07 0 1 1-2.93-2.93l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2.07 2.07 0 1 1 0-4.14h.1a1.7 1.7 0 0 0 1.56-1.12 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2.07 2.07 0 1 1 2.93-2.93l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V3a2.07 2.07 0 1 1 4.14 0v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2.07 2.07 0 1 1 2.93 2.93l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2.07 2.07 0 1 1 0 4.14h-.1a1.7 1.7 0 0 0-1.56 1.04Z" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 20h8M12 17v3" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.8 4.8L18.6 9.6 13.8 11.4 12 16.2 10.2 11.4 5.4 9.6 10.2 7.8 12 3ZM19 14l.9 2.1 2.1.9-2.1.9L19 20l-.9-2.1L16 17l2.1-.9.9-2.1Z" />
  ),
  skills: (
    <>
      <path d="M4 7h16l-1.2 11.4A2 2 0 0 1 16.8 20H7.2a2 2 0 0 1-2-1.6L4 7Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />,
  split: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5v14" />
    </>
  ),
  single: <rect x="3" y="5" width="18" height="14" rx="2" />,
  send: <path d="M3.4 20.4l17.45-8.17a1 1 0 0 0 0-1.82L3.4 2.24A1 1 0 0 0 2 3.18v6.32l14 1.82L2 13.14v6.32a1 1 0 0 0 1.4.94Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  pause: <path d="M9 5v14M15 5v14" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L20 8l-4-4L4 16v4ZM15 5l4 4" />,
  logo: (
    <>
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5Z" />
      <path d="M12 22V12M3 7l9 5 9-5" />
    </>
  ),
  bot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 4v4M9 13h.01M15 13h.01M2 13v3M22 13v3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  chart: <path d="M3 3v18h18M7 15l4-4 4 4 5-6" />,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
  sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h14M18 18h2M16 6a2 2 0 1 0 0-.01M10 12a2 2 0 1 0 0-.01M16 18a2 2 0 1 0 0-.01" />,
  shield: <path d="M12 2 4 5v6.5c0 5 3.6 8.6 8 9.5 4.4-.9 8-4.5 8-9.5V5l-8-3Z" />,
  feather: <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.76ZM16 8 2 22M17.5 15H9" />,
  "arrow-right": <path d="M5 12h14M13 5l7 7-7 7" />,
  "arrow-down": <path d="M12 5v14M5 13l7 7 7-7" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  globe: <path d="M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20M2 12h20M3.5 7h17M3.5 17h17M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />,
  file: <path d="M14 3v5h5M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />,
};

export default function Icon({ name, size = 16, stroke = 1.75, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
