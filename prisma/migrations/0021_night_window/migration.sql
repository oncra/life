-- The meadow-bird window: a node may listen for an hour or so after sunset in spring, when black-tailed godwit, lapwing
-- and snipe call most, if the place's owner turns it on. Off by default, outside the readings (src/lib/listening.ts
-- counts only the core windows), and with the battery option only on an evening the battery can carry it. The node
-- hears the settings with its next heartbeat answer whenever nightRev differs from the rev it reports.

ALTER TABLE "Device" ADD COLUMN "nightOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN "nightStartMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Device" ADD COLUMN "nightLenMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Device" ADD COLUMN "nightFrom" TEXT NOT NULL DEFAULT '03-25';
ALTER TABLE "Device" ADD COLUMN "nightTo" TEXT NOT NULL DEFAULT '06-30';
ALTER TABLE "Device" ADD COLUMN "nightBattery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Device" ADD COLUMN "nightMinV" DOUBLE PRECISION NOT NULL DEFAULT 13.1;
ALTER TABLE "Device" ADD COLUMN "nightRev" INTEGER NOT NULL DEFAULT 0;
