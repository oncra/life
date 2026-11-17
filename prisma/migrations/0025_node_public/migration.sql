-- A switch per place: is its node dashboard public? Decided 12 October 2026: a node's dashboard may be public only
-- while the box is not at a private field site. Off, the dashboard, its status, the species the node heard, their clips
-- and its dot on the maps are only for those who may see the place exactly (its owner, people given access, its steward
-- key, admins); everyone else gets the 404 a private place gives. On by default, so every place stays as it was.
ALTER TABLE "Place" ADD COLUMN "nodePublic" BOOLEAN NOT NULL DEFAULT true;
