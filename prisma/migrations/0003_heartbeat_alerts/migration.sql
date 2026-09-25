-- Node liveness and theft: heartbeats with the serving cell, and alerts when a node falls silent or its cell changes.

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('SILENT', 'MOVED');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "homeCell" JSONB,
ADD COLUMN "cell" JSONB;

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "event" TEXT,
    "cell" JSONB,
    "metrics" JSONB,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Heartbeat_deviceId_ts_idx" ON "Heartbeat"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "Alert_deviceId_resolvedAt_idx" ON "Alert"("deviceId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "Heartbeat" ADD CONSTRAINT "Heartbeat_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
