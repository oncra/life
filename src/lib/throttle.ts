// The Raspberry Pi firmware's throttle flags (vcgencmd get_throttled), as the Life Node heartbeat reports them.

/** What the Pi firmware's throttle flags say, in words: the cores slowed (now or since boot) and the supply sagged under
 * the Pi's limit (now or since boot), as `vcgencmd get_throttled` sets bits 1-3 and 17-19, and 0 and 16. */
export function throttleText(hex: string | null): string {
  if (!hex) return "";
  const f = Number.parseInt(hex, 16);
  if (!Number.isFinite(f)) return "";
  const parts: string[] = [];
  if (f & 0b1110) parts.push("slowed down now");
  else if (f & 0xe0000) parts.push("slowed down since it started");
  if (f & 0b1) parts.push("supply under 4.63 V now");
  else if (f & 0x10000) parts.push("supply dipped since it started");
  return parts.join(", ");
}
