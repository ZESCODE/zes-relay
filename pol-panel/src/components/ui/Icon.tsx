import type { SVGProps } from "react";

/**
 * Tiny inline icon set. No icon package: every glyph is a path we own, which
 * keeps the bundle small on a Termux install.
 */
export type IconName =
  | "dashboard"
  | "models"
  | "playground"
  | "logs"
  | "config"
  | "admin"
  | "play"
  | "stop"
  | "restart"
  | "refresh"
  | "check"
  | "cross"
  | "warning"
  | "search"
  | "download"
  | "trash"
  | "plus"
  | "send"
  | "copy"
  | "eye"
  | "eyeOff"
  | "logout"
  | "sun"
  | "moon"
  | "chevronDown"
  | "chevronUp"
  | "clock"
  | "bolt"
  | "terminal"
  | "shield"
  | "arrowUp"
  | "arrowDown"
  | "pause"
  | "filter";

const PATHS: Record<IconName, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  models:
    "M4 6h16M4 12h16M4 18h10M18.5 17.5a1.5 1.5 0 1 0 0-.01M8.5 5.5a1.5 1.5 0 1 0 0-.01",
  playground: "M8 10h8M8 14h5M4 5h16v14H4z",
  logs: "M5 4h9l5 5v11H5zM9 12h7M9 16h7M9 8h3",
  config:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5-2-.6a6 6 0 0 0-.6-1.5l1-1.8-1.8-1.8-1.8 1a6 6 0 0 0-1.5-.6L12.7 4h-2.4l-.6 2.2a6 6 0 0 0-1.5.6l-1.8-1-1.8 1.8 1 1.8a6 6 0 0 0-.6 1.5l-2.2.6v2.4l2.2.6c.15.53.35 1.03.6 1.5l-1 1.8 1.8 1.8 1.8-1c.47.25.97.45 1.5.6l.6 2.2h2.4l.6-2.2a6 6 0 0 0 1.5-.6l1.8 1 1.8-1.8-1-1.8c.25-.47.45-.97.6-1.5l2-.6z",
  admin: "M12 3 5 6v6c0 4 3 7.4 7 9 4-1.6 7-5 7-9V6l-7-3Z",
  play: "M8 5.5v13l11-6.5-11-6.5Z",
  stop: "M7 7h10v10H7z",
  restart: "M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4",
  refresh: "M4 12a8 8 0 0 1 13.66-5.66L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.66 5.66L4 16m0 4v-4h4",
  check: "m5 13 4 4L19 7",
  cross: "M6 6l12 12M18 6 6 18",
  warning: "M12 4 2.5 20h19L12 4Zm0 6v5m0 3h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  download: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  plus: "M12 5v14M5 12h14",
  send: "M4 12 20 4l-6 16-3-6-7-2Z",
  copy: "M9 9h10v10H9zM5 15V5h10",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  eyeOff: "M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4.1M6.3 8A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1 0 2-.2 2.9-.5M9.9 9.9a3 3 0 0 0 4.2 4.2",
  logout: "M15 17l5-5-5-5M20 12H9M12 4H5v16h7",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  chevronDown: "m6 9 6 6 6-6",
  chevronUp: "m6 15 6-6 6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6l1-7Z",
  terminal: "M5 5h14v14H5zm3 4 3 3-3 3m5 0h4",
  shield: "M12 3 5 6v6c0 4 3 7.4 7 9 4-1.6 7-5 7-9V6l-7-3Zm-2.5 9 2 2 4-4",
  arrowUp: "M12 20V5m0 0-6 6m6-6 6 6",
  arrowDown: "M12 4v15m0 0 6-6m-6 6-6-6",
  pause: "M9 5v14M15 5v14",
  filter: "M4 5h16l-6 7v6l-4 2v-8L4 5Z",
};

const FILLED: IconName[] = ["dashboard", "play", "stop"];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
