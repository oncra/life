-- A place's demo (2026-11-18): until this moment its node's demo page shows where the node is now, worked out from the
-- 4G cell it hears, and the node sends its birds every twenty seconds while it is live. Null: no demo. Set and cleared
-- by someone who manages the place, on /places/{slug}/demo.
ALTER TABLE "Place" ADD COLUMN "demoUntil" TIMESTAMP(3);
