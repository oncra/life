/** LiFePO4 12.8 V: below 12.0 V at rest is the last tenth or so of the charge; 12.8 V is comfortably back. */
export const LOW_BATTERY_V = Number(process.env.LOW_BATTERY_V ?? 12.0);
export const LOW_BATTERY_OK_V = Number(process.env.LOW_BATTERY_OK_V ?? 12.8);

/**
 * The battery voltage a heartbeat carries, and where it came from. The charge controller's own reading (VE.Direct)
 * wins. Without it the Witty Pi's input stands in, because on a node that is the controller's load output, the battery
 * less a few tenths; only on a 12 V system though, since a box on the desk feeds the Witty Pi 5 V over USB.
 */
export function batteryOf(m: Record<string, unknown> | null | undefined): { v: number; src: "mppt" | "wittypi" } | null {
  if (!m) return null;
  if (typeof m.battV === "number" && m.battV > 0) return { v: m.battV, src: "mppt" };
  if (typeof m.vinV === "number" && m.vinV >= 9 && m.vinV <= 16) return { v: m.vinV, src: "wittypi" };
  return null;
}
