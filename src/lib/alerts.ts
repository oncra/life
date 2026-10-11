import { prisma } from "./db";
import type { AlertKind } from "@/generated/prisma/client";
import { batteryOf, LOW_BATTERY_OK_V, LOW_BATTERY_V } from "./battery";

/**
 * Node liveness and theft, without hardware.
 *
 * A node posts a heartbeat with the cell its modem is camped on (PLMN + cell id, read from the 4G stick's own
 * web API). The first cell heard becomes the device's home cell, and home is a set, not one cell: a node that
 * stands still is handed from cell to cell, between bands, between 3G and 4G and, on a roaming SIM, between
 * operators (node 1 reported five cells on two operators from one desk in an afternoon). Every cell heard in
 * the first HOME_LEARN_DAYS after the home cell was set counts as home. After that a new cell in a tracking
 * area the node has been in before is added quietly, and a cell in an area it has never been in opens a
 * MOVED alert: the box has travelled, and the cell says roughly where to. A device that has ever sent a
 * heartbeat and then stays quiet for SILENT_AFTER_H hours gets a SILENT alert; the next heartbeat resolves it.
 * Silent and moved are different failures and are kept apart on purpose.
 *
 * Each opened alert is pushed to ALERT_WEBHOOK_URL as {title, body, url, tag} with ALERT_WEBHOOK_TOKEN as
 * bearer, when those are set. Any endpoint that takes that shape will do; there is no mail from here.
 *
 * A second, quieter hook is for a status line somewhere a steward already looks: CHECKIN_WEBHOOK_URL gets one
 * short line per heartbeat ("checked in, battery 12.9 V, 14 °C in the box") and one per opened alert, as
 * {who, text, url, tag, tone} with tone "close" for a check-in and "urgent" for an alert, CHECKIN_WEBHOOK_TOKEN
 * as bearer. It never holds a heartbeat up for more than a few seconds and never fails one.
 */

export type Cell = { plmn?: string; cellId?: string | number; tac?: string | number; pci?: number; band?: string; rsrp?: number; rssi?: number; sinr?: number; mode?: string };

export const SILENT_AFTER_H = Number(process.env.SILENT_AFTER_H ?? 36);


/** Days after a home cell is set (first heartbeat, or a steward re-homing the node) in which every cell heard is home. */
export const HOME_LEARN_DAYS = Number(process.env.HOME_LEARN_DAYS ?? 14);
const HOME_CELLS_MAX = 64;

type CellId = { plmn?: string; cellId?: string | number; tac?: string | number };
export type HomeCell = CellId & { since?: string; rehomedBy?: string; cells?: (CellId & { firstSeen: string })[] };

/** The identity part of a cell: what must match for "same cell". Signal figures are left out. */
export function cellKey(c: Cell | null | undefined): string | null {
  if (!c || c.cellId === undefined || c.cellId === null || c.cellId === "") return null;
  return `${c.plmn ?? "?"}/${c.cellId}`;
}

/** Operator and tracking area (LAC on 3G): the neighbourhood a cell belongs to, tens of cells wide. */
export function areaKey(c: CellId | null | undefined): string | null {
  if (!c || c.tac === undefined || c.tac === null || c.tac === "") return null;
  return `${c.plmn ?? "?"}/${c.tac}`;
}

/**
 * Where a heartbeat's cell stands against the node's home: a cell it has been on, a new cell that still counts as
 * home (inside the learning window, or in a tracking area it has been in), or away. `learned` is the home record
 * with the new cell added, to be stored; it is set only in the second case.
 */
export function placeCell(home: HomeCell, cell: Cell, at: Date): { away: boolean; learned?: HomeCell } {
  const known = home.cells ?? [{ plmn: home.plmn, cellId: home.cellId, tac: home.tac, firstSeen: home.since ?? at.toISOString() }];
  const key = cellKey(cell);
  if (known.some((k) => cellKey(k) === key)) return { away: false };
  const area = areaKey(cell);
  const learning = home.since ? at.getTime() - new Date(home.since).getTime() < HOME_LEARN_DAYS * 864e5 : false;
  if (!learning && !(area && known.some((k) => areaKey(k) === area))) return { away: true };
  const cells = [...known, { plmn: cell.plmn, cellId: cell.cellId, tac: cell.tac, firstSeen: at.toISOString() }].slice(-HOME_CELLS_MAX);
  return { away: false, learned: { ...home, cells } };
}

/** One status line to CHECKIN_WEBHOOK_URL. The tag is unique per line, so a reader that keeps lines by tag shows each. */
export async function line(who: string, text: string, url: string, tag: string, tone: "close" | "urgent"): Promise<boolean> {
  const hook = process.env.CHECKIN_WEBHOOK_URL;
  if (!hook) return false;
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.CHECKIN_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.CHECKIN_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ who, text, url, tag, tone }),
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** What a heartbeat says in one line: what the node did, its battery, the air in the box, and what it still holds. */
export function checkinText(hb: { event?: string | null; metrics?: Record<string, unknown> | null }): string {
  const m = hb.metrics ?? {};
  const did = hb.event === "boot" ? "started" : hb.event === "shutdown" ? "switching off" : hb.event === "alarm" ? "alarm" : "checked in";
  const parts = [did];
  const batt = batteryOf(m);
  if (batt) parts.push(`battery ${batt.v.toFixed(2)} V`);
  if (typeof m.boxTempC === "number") parts.push(`${Math.round(m.boxTempC)} °C in the box`);
  if (typeof m.unsent === "number" && m.unsent > 0) parts.push(`${m.unsent} readings still to send`);
  return parts.join(", ");
}

export async function notify(title: string, body: string, url?: string, tag?: string): Promise<boolean> {
  await line(title, body, url ?? "", `${tag ?? "life-alert"}-${Date.now()}`, "urgent");
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
  else if (kind === "LOW_BATTERY") await notify(`Life node battery low: ${d.place.name}`, `${where}: battery ${String(detail.v)} V${detail.charge ? `, charger ${String(detail.charge)}` : ""}${typeof detail.pvW === "number" ? `, panel ${detail.pvW} W` : ""}. It will go quiet when the controller cuts the load, and come back with the sun.`, `${site}/places/${d.place.slug}`, `life-battery-${deviceId}`);
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
  const home = dev.homeCell as HomeCell | null;
  const homeKey = cellKey(home);
  const data: Record<string, unknown> = { lastHeartbeatAt: ts };
  if (hb.cell) data.cell = { ...hb.cell, seenAt: ts.toISOString() };
  let cellChanged = false;
  if (key && !homeKey) data.homeCell = { plmn: hb.cell!.plmn, cellId: hb.cell!.cellId, tac: hb.cell!.tac, since: ts.toISOString() };
  else if (key && home) {
    const where = placeCell(home, hb.cell!, ts);
    cellChanged = where.away;
    if (where.learned) data.homeCell = where.learned;
  }
  await prisma.device.update({ where: { id: deviceId }, data });
  const silent = await resolveAlerts(deviceId, "SILENT", "heartbeat");
  let moved = null;
  if (cellChanged) moved = await openAlert(deviceId, "MOVED", { from: { plmn: home!.plmn, cellId: home!.cellId, tac: home!.tac, since: home!.since }, to: hb.cell, at: ts.toISOString() });
  else if (key && homeKey) await resolveAlerts(deviceId, "MOVED", "heartbeat");   // heard from home again: it had not travelled
  const maintenance = maintenanceOut(dev);
  let tamper = null;
  // a tamper inside an active window is the steward at work: recorded in the heartbeat, no alert, no push
  if (hb.event === "alarm" && !(maintenance && maintenance.active)) tamper = await openAlert(deviceId, "TAMPER", { loop: hb.tamper?.loop ?? "unknown", state: hb.tamper?.state, cell: hb.cell, cellChanged, maintenance: false, at: ts.toISOString() });
  const batt = batteryOf(hb.metrics);
  let lowBattery = null;
  if (batt && batt.v < LOW_BATTERY_V) lowBattery = await openAlert(deviceId, "LOW_BATTERY", { v: batt.v, src: batt.src, charge: hb.metrics?.charge, pvW: hb.metrics?.pvW, event: hb.event, at: ts.toISOString() });
  else if (batt && batt.v >= LOW_BATTERY_OK_V) await resolveAlerts(deviceId, "LOW_BATTERY", "heartbeat");
  if (process.env.CHECKIN_WEBHOOK_URL) {
    const d = await placeOf(deviceId);
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org";
    await line(`Life node: ${d.place.name}`, checkinText(hb), `${site}/places/${d.place.slug}`, `life-checkin-${deviceId}-${ts.getTime()}`, "close");
  }
  return { recovered: silent.count > 0, moved: moved !== null, tamper: tamper !== null, lowBattery: lowBattery !== null, homeCell: key && !homeKey ? "set" : undefined, maintenance };
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
