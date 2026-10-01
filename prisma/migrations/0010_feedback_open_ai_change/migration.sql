-- An AI change no longer needs a code: it is applied straight away and the maintainer keeps it or rolls it back.
-- ipHash lets the endpoint limit how many changes one visitor can start; ROLLED_BACK records the maintainer's no.
ALTER TYPE "FeedbackStatus" ADD VALUE 'ROLLED_BACK';
ALTER TABLE "PlanFeedback" ADD COLUMN "ipHash" TEXT;
CREATE INDEX "PlanFeedback_ipHash_createdAt_idx" ON "PlanFeedback"("ipHash", "createdAt");
