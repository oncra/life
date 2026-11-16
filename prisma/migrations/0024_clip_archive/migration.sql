-- The research archive (src/lib/clip-archive.ts). The oracle keeps a clip's sound 30 days for triage; before it goes,
-- a clip worth keeping for research is copied to the archive: every clip scored 0.5 or more, every clip someone has
-- judged, and a sample of the rest (at most five per microphone, species, month and score band of 0.1).
-- archivedAt: when its sound reached the archive, archiveFile: its name there (the oracle forgets `file` when it deletes
-- its own copy). archiveSkip: judged not worth keeping, so its sound may go.
ALTER TABLE "Clip" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Clip" ADD COLUMN "archiveFile" TEXT;
ALTER TABLE "Clip" ADD COLUMN "archiveSkip" BOOLEAN NOT NULL DEFAULT false;
