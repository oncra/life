-- Feedback on the Life Box build plan: notes shown on the page, and change requests for the plan's change runner.
CREATE TYPE "FeedbackKind" AS ENUM ('NOTE', 'AI_CHANGE');
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'QUEUED', 'RUNNING', 'DONE', 'BLOCKED', 'DISMISSED');

CREATE TABLE "PlanFeedback" (
  "id"         TEXT NOT NULL,
  "page"       TEXT NOT NULL,
  "kind"       "FeedbackKind" NOT NULL,
  "status"     "FeedbackStatus" NOT NULL DEFAULT 'NEW',
  "body"       TEXT NOT NULL,
  "author"     TEXT,
  "note"       TEXT,
  "changeUrl"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"  TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "PlanFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanFeedback_page_createdAt_idx" ON "PlanFeedback"("page", "createdAt");
CREATE INDEX "PlanFeedback_status_createdAt_idx" ON "PlanFeedback"("status", "createdAt");
