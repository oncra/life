-- The build backlog: a kanban of ideas met while building. Everyone can read it; changes need the board password,
-- a sign-in or the admin key. rank orders the cards within a lane, lowest on top.
CREATE TYPE "BacklogLane" AS ENUM ('BACKLOG', 'NEXT', 'DOING', 'DONE');

CREATE TABLE "BacklogCard" (
  "id"        TEXT NOT NULL,
  "lane"      "BacklogLane" NOT NULL DEFAULT 'BACKLOG',
  "rank"      DOUBLE PRECISION NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "author"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "doneAt"    TIMESTAMP(3),
  CONSTRAINT "BacklogCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BacklogCard_lane_rank_idx" ON "BacklogCard"("lane", "rank");
