-- A node's battery, read from its heartbeat (VE.Direct, or the Witty Pi's input on a 12 V system), fell below
-- LOW_BATTERY_V. Resolved by the next heartbeat at or above LOW_BATTERY_OK_V.
ALTER TYPE "AlertKind" ADD VALUE 'LOW_BATTERY';
