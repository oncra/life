-- Settings over the air. A Life Node reports the rev of the settings it runs with every heartbeat, and the oracle's
-- answer carries new ones only when its own differ: the method's listening windows as rules, so a new version of the
-- method reaches every node without a visit, and a short list of the node's own settings within fixed bounds
-- (node/life-config.py). The place's owner sets those on the node dashboard. configN counts the saves, so a save
-- always gives a new rev.
ALTER TABLE "Device" ADD COLUMN "configN" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Device" ADD COLUMN "config" JSONB;
ALTER TABLE "Device" ADD COLUMN "configAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "configBy" TEXT;
