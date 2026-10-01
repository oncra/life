-- A Life Box can be set up for a place that already exists (registered for its landholder) instead of getting a
-- place of its own. Such a box must never redraw that place's boundary when it is put in the ground.
ALTER TABLE "Box" ADD COLUMN "ownPlace" BOOLEAN NOT NULL DEFAULT true;
