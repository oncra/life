-- Clips from field nodes. A node keeps its clips and sends them over a cable or a WiFi it is on, or lets them go when
-- someone visits it: it joins the visitor's phone hotspot and sends them itself, or a laptop on the node's own WiFi
-- takes them and sends them later with the node's grant. Either way the node deletes a clip only once the oracle has
-- it with the same SHA-256.

-- the WiFi a node uses on a visit, set by the place's owner on the node dashboard and sent to the node with its next
-- heartbeat answer whenever visitRev differs from the rev the node reports
ALTER TABLE "Device" ADD COLUMN "visitSsid" TEXT;
ALTER TABLE "Device" ADD COLUMN "visitPsk" TEXT;
ALTER TABLE "Device" ADD COLUMN "visitApPsk" TEXT;
ALTER TABLE "Device" ADD COLUMN "visitRev" INTEGER NOT NULL DEFAULT 0;

-- the sound's SHA-256 as received (echoed to the sender, who deletes its copy only on a match), the gain the node
-- applied to level it, and the laptop batch it came in with
ALTER TABLE "Clip" ADD COLUMN "sha256" TEXT;
ALTER TABLE "Clip" ADD COLUMN "gainDb" DOUBLE PRECISION;
ALTER TABLE "Clip" ADD COLUMN "batch" TEXT;

-- days the oracle keeps a clip's sound for this place: null for CLIP_KEEP_DAYS, 0 for as long as the place exists
ALTER TABLE "Place" ADD COLUMN "clipKeepDays" INTEGER;

-- clips a laptop took from a node, as the node listed them when it signed them over
CREATE TABLE "ClipBatch" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "laptop" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClipBatch_deviceId_batch_key" ON "ClipBatch"("deviceId", "batch");
ALTER TABLE "ClipBatch" ADD CONSTRAINT "ClipBatch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
