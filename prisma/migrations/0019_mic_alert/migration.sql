-- MIC: one of a node's two microphones has moved against the other (a covered port, water behind a membrane, a failing
-- microphone), or gave no sound levels for a day (src/lib/mics.ts, node/life-mic.py `levels`).
ALTER TYPE "AlertKind" ADD VALUE 'MIC';
