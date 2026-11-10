-- Live posts. A Life Node on WiFi or a cable says how it is doing every 20 seconds (node/life-live.py), for the status
-- panel on its dashboard; on 4G it never does, to spare the SIM. The device keeps the latest post and the samples of
-- the last fifteen minutes in one row, overwritten each time: the heartbeats stay the record.
ALTER TABLE "Device" ADD COLUMN "live" JSONB;
ALTER TABLE "Device" ADD COLUMN "liveAt" TIMESTAMP(3);
