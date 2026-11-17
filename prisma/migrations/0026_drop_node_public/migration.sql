-- The per-place switch for the node dashboard (0025) comes out again. Decided 17 November 2026: a node's data is never
-- hidden. Its dashboard, its status, the species it heard, their clips and its place in the shared lists stay public
-- for every place, because sharing that data is the point; at a private field site only the exact location is kept
-- back, which is Place.locationHidden, the switch the node dashboard now gives the place's owner. No place had turned
-- nodePublic off, so dropping it changes nothing anyone sees.
ALTER TABLE "Place" DROP COLUMN "nodePublic";
