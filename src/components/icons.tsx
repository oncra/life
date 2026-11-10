// The node's line icons as path fragments for LineIcon (24 px grid, stroke 1.6), in one place so the home page's
// points (NodeWhy) and the status panel on the node dashboard draw the same sun, signal and bird.
export const ICON = {
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.55 1.55M16.65 16.65l1.55 1.55M5.8 18.2l1.55-1.55M16.65 7.35l1.55-1.55" /></>,
  // phone signal
  signal: <path d="M4.5 19.5V16M9.5 19.5V12.5M14.5 19.5V9M19.5 19.5V5" />,
  // a bird singing
  bird: <><path d="M15.56 9.12L13.7 8.45A2.2 2.2 0 0 0 9.58 8.45C7.96 9.12 6.44 10.96 5.72 12.72L2.2 15.28L2.84 16.4L6.52 15.12C9.4 16.72 13.96 14.48 13.81 9.58Z" /><path d="M11.96 8.64h.01" /><path d="M8.6 15.5v2.9M10.8 15.4v3" /><path d="M17.4 7.28a2.6 2.6 0 0 1 0 3.68M19.1 5.58a5 5 0 0 1 0 7.08" /></>,
  bat: <path d="M12 8.1L13.3 6.5L13.9 9C16.2 7.4 19.2 6.6 21.6 6.6C20.6 8.4 20.1 10.4 20.2 12.6C19.1 11.4 17.4 11.4 16.6 13C15.8 12.2 14.5 12.6 14.1 14.6C13.4 15.2 12.6 16.2 12 17.4C11.4 16.2 10.6 15.2 9.9 14.6C9.5 12.6 8.2 12.2 7.4 13C6.6 11.4 4.9 11.4 3.8 12.6C3.9 10.4 3.4 8.4 2.4 6.6C4.8 6.6 7.8 7.4 10.1 9L10.7 6.5Z" />,
  // an alarm light
  siren: <><path d="M7 18v-5a5 5 0 0 1 10 0v5" /><rect x="5" y="18" width="14" height="2.6" rx="1" /><path d="M12 3v2.1M4.6 5.9l1.5 1.5M19.4 5.9l-1.5 1.5M2.6 12.4h2M19.4 12.4h2" /><path d="M12 11.8v3.2" /></>,
  euro: <><circle cx="12" cy="12" r="8.4" /><path d="M15.5 9.2a3.6 3.6 0 1 0 0 5.6M8.1 11h5.2M8.1 13h5.2" /></>,
  // a battery with a bolt
  battery: <><rect x="2.8" y="7.2" width="16.4" height="9.6" rx="2" /><path d="M21.2 10.4v3.2" /><path d="M11.6 9.4l-2.3 3h3.4l-2.3 3" /></>,
  thermometer: <><path d="M10 13.7V5.2a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z" /><path d="M12 9.2v6.4" /></>,
  drop: <path d="M12 3.6c3.4 4.1 5.6 7.2 5.6 10.1a5.6 5.6 0 0 1-11.2 0c0-2.9 2.2-6 5.6-10.1z" />,
  clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.4V12l3.1 1.9" /></>,
  // a memory card
  card: <><path d="M7.2 3.4h7.4l3.6 3.6v12.6a1 1 0 0 1-1 1H7.2a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1z" /><path d="M9.6 3.4v3.2M12 3.4v3.2M14.4 3.4v3.2" /></>,
};
