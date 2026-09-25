-- Tamper alarm: a third alert kind, and a steward-declared maintenance window per device.

-- AlterEnum
ALTER TYPE "AlertKind" ADD VALUE 'TAMPER';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "maintenanceFrom" TIMESTAMP(3),
ADD COLUMN "maintenanceUntil" TIMESTAMP(3);
