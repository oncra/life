---
title: "Life Box: the build plan"
short: "From a heap of parcels to a node on a post, in six stages with a measured gate each."
---

One box, one post, one radio. The [Life Box](https://climatecleanup.org/the-life-box-a-feedback-loop-for-living-systems/) listens for birds, reads two soil probes and posts what it hears and feels to the [life oracle](https://life.oncra.org) over 4G, on solar power, for ten years. The design is settled and most of the parts are on the table. **Nothing has been built and nothing has been measured yet.** This site is the order of work, one page per stage, written so that anyone can follow it, and so that an AI coding agent can do the parts that are typing rather than handwork.

Each stage ends in a gate: a number you measured or a fact you checked, never a feeling. A stage can send you back one stage. None can be skipped, and the box is not closed before the electronics have run open on the desk.

**How to read a stage page.** Every step says in plain words what you do with your hands, then, in a green-edged box, what an AI agent can do for you. Copy the box into Claude Code, Codex or a similar agent that can run commands on your laptop and reach the node over SSH. The agent does the typing and the checking; you do the plugging, the reading of the meter, and the decisions. The pictures are rendered impressions until the real photo of that step exists; they get replaced as the build gets there, starting with the parcels below. The long form with all the reasoning is the [build plan document](../build.md); the design is the [kit page](../kit.md).

```ai What an agent needs before it can help with any stage
Clone https://github.com/oncra/life and read content/build.md and node/README.md once.
Ask the person for three things and keep them in the shell, never in a file you commit:
  LIFE_ADMIN_KEY   (oracle admin or steward key; the maintainer has it)
  NODE=life@life-node-1.local   (SSH target of the node once it boots; password or key from the image build)
  LIFEBOX_ACCESS_CODE  (optional: lets you queue an "AI change" on these plan pages)
Rules: you measure nothing, the person reads the meter and tells you the number.
Every number you record goes into kit/bench-log.csv (measured, date, notes columns) by commit and pull request, never into prose.
Never change a modelled value. Never enable audio clip saving on the node. Never put a token in a commit.
```
