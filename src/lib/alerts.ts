import { prisma } from "./db";
import type { AlertKind } from "@/generated/prisma/client";

/**
 * Node liveness and theft, without hardware.
 *
 * A node posts a heartbeat with the cell its modem is camped on (PLMN + cell id, read from the 4G stick's own
 * web API). The first cell heard becomes the device's home cell. A later heartbeat from another cell opens a
 * MOVED alert: the box has travelled, and the cell says roughly where to. A device that has ever sent a
 * heartbeat and then stays quiet for SILENT_AFTER_H hours gets a SILENT alert; the next heartbeat resolves it.
 * Silent and moved are different failures and are kept apart on purpose.
 *
 * Each opened alert is pushed to ALERT_WEBHOOK_URL as {title, body, url, tag} with ALERT_WEBHOOK_TOKEN as
 * bearer, when those are set. Any endpoint that takes that shape will do; there is no mail from here.
 */

export type Cell = { plmn?: string; cellId?: string | number; tac?: string | number; pci?: number; band?: string; rsrp?: number; rssi?: number; sinr?: number; mode?: string };

export const SILENT_AFTER_H = Number(process.env.SILENT_AFTER_H ?? 36);

/** The identity part of a cell: what must match for "same place". Signal figures are left out. */
export function cellKey(c: Cell | null | undefined): string | null {
  if (!c || c.cellId === undefined || c.cellId === null || c.cellId === "") return null;
  return `${c.plmn ?? "?"}/${c.cellId}`;
}

export async function notify(title: string, body: string, url?: string, tag?: string): Promise<boolean> {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return false;
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.ALERT_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ title, body, url, tag }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function placeOf(deviceId: string) {
  const d = await prisma.device.findUniqueOrThrow({ where: { id: deviceId }, include: { place: { select: { slug: true, name: true } } } });
  return d;
}

/** Open an alert unless one of the same kind is already open on the device. Returns the alert, or null if one was open. */
export async function openAlert(deviceId: string, kind: AlertKind, detail: Record<string, unknown>) {
  const open = await prisma.alert.findFirst({ where: { deviceId, kind, resolvedAt: null } });
  if (open) return null;
  const alert = await prisma.alert.create({ data: { deviceId, kind, detail: detail as object } });
  const d = await placeOf(deviceId);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org";
  const where = `${d.place.name} (${d.model})`;
  if (kind === "MOVED") await notify(`Life node moved: ${d.place.name}`, `${where} is on another cell than it was installed in. Check the box.`, `${site}/places/${d.place.slug}`, `life-moved-${deviceId}`);
  else if (kind === "TAMPER") await notify(`Life node tamper: ${d.place.name}`, `${where}: ${String(detail.loop ?? "a loop")} opened, ${detail.cellChanged ? "cell changed" : "cell unchanged"}${detail.maintenance ? ", inside a maintenance window" : ", no maintenance window"}.`, `${site}/places/${d.place.slug}`, `life-tamper-${deviceId}`);
  else await notify(`Life node silent: ${d.place.name}`, `${where} has not been heard for ${SILENT_AFTER_H} h.`, `${site}/places/${d.place.slug}`, `life-silent-${deviceId}`);
  return alert;
}

export async function resolveAlerts(deviceId: string, kind: AlertKind, by: string) {
  return prisma.alert.updateMany({ where: { deviceId, kind, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedBy: by } });
}

export type HeartbeatIn = { ts?: string; event?: string; tamper?: { loop: string; state?: string }; cell?: Cell; metrics?: Record<string, unknown> };

export type MaintenanceOut = { from: string | null; until: string; active: boolean } | null;

/** The steward's maintenance window as the node should see it: null when none or already over. */
export function maintenanceOut(d: { maintenanceFrom: Date | null; maintenanceUntil: Date | null }, now = new Date()): MaintenanceOut {
  if (!d.maintenanceUntil || d.maintenanceUntil <= now) return null;
  const from = d.maintenanceFrom ?? null;
  return { from: from?.toISOString() ?? null, until: d.maintenanceUntil.toISOString(), active: !from || from <= now };
}

/** Store a heartbeat, keep the device's cell and home cell, open or resolve alerts. */
export async function recordHeartbeat(deviceId: string, hb: HeartbeatIn) {
  const ts = hb.ts ? new Date(hb.ts) : new Date();
  const dev = await prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select: { homeCell: true, maintenanceFrom: true, maintenanceUntil: true } });
  await prisma.heartbeat.create({ data: { deviceId, ts, event: hb.event, cell: hb.cell as object | undefined, metrics: hb.metrics as object | undefined } });
  const key = cellKey(hb.cell);
  const homeKey = cellKey(dev.homeCell as Cell | null);
  const data: Record<string, unknown> = { lastHeartbeatAt: ts };
  if (hb.cell) data.cell = { ...hb.cell, seenAt: ts.toISOString() };
  if (key && !homeKey) data.homeCell = { plmn: hb.cell!.plmn, cellId: hb.cell!.cellId, tac: hb.cell!.tac, since: ts.toISOString() };
  await prisma.device.update({ where: { id: deviceId }, data });
  const silent = await resolveAlerts(deviceId, "SILENT", "heartbeat");
  let moved = null;
  const cellChanged = Boolean(key && homeKey && key !== homeKey);
  if (cellChanged) moved = await openAlert(deviceId, "MOVED", { from: dev.homeCell, to: hb.cell, at: ts.toISOString() });
  const maintenance = maintenanceOut(dev);
  let tamper = null;
  // a tamper inside an active window is the steward at work: recorded in the heartbeat, no alert, no push
  if (hb.event === "alarm" && !(maintenance && maintenance.active)) tamper = await openAlert(deviceId, "TAMPER", { loop: hb.tamper?.loop ?? "unknown", state: hb.tamper?.state, cell: hb.cell, cellChanged, maintenance: false, at: ts.toISOString() });
  return { recovered: silent.count > 0, moved: moved !== null, tamper: tamper !== null, homeCell: key && !homeKey ? "set" : undefined, maintenance };
}

/** Worker sweep: devices that have sent heartbeats and then stopped. */
export async function sweepSilent(log: (s: string) => void = () => {}) {
  const cutoff = new Date(Date.now() - SILENT_AFTER_H * 3600e3);
  const quiet = await prisma.device.findMany({ where: { lastHeartbeatAt: { not: null, lt: cutoff } }, select: { id: true, lastHeartbeatAt: true, model: true } });
  let opened = 0;
  for (const d of quiet) {
    const a = await openAlert(d.id, "SILENT", { lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() });
    if (a) { opened++; log(`silent: ${d.model} ${d.id}, last heartbeat ${d.lastHeartbeatAt?.toISOString()}`); }
  }
  return { checked: quiet.length, opened };
}
