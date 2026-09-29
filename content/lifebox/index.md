---
title: "Life Box: the build plan"
short: "From a heap of parcels to a node on a post, in six stages with a measured gate each."
---

One box, one post, one radio. The [Life Box](https://climatecleanup.org/the-life-box-a-feedback-loop-for-living-systems/) listens for birds, reads two soil probes and posts what it hears and feels to the [life oracle](https://life.oncra.org) over 4G, on solar power, for ten years. The design is settled and most of the parts are on the table. **Nothing has been built and nothing has been measured yet.** This site is the order of work, one page per stage, written so that anyone can follow it, and so that an AI coding agent can do the parts that are typing rather than handwork.

Each stage ends in a gate: a number you measured or a fact you checked, never a feeling. A stage can send you back one stage. None can be skipped, and the box is not closed before the electronics have run open on the desk.

**How to read a stage page.** Every step says in plain words what you do with your hands, then, in a green-edged box, what an AI agent can do for you. Copy the box below into Claude Code, Codex or a similar agent that can run commands on your laptop; it contains everything the agent needs to start from nothing. The boxes on the stage pages each repeat the two or three facts they depend on, so any one of them can be pasted on its own. The agent does the typing and the checking; you do the plugging, the reading of the meter, and the decisions. The pictures are rendered impressions until the real photo of that step exists; they get replaced as the build gets there, starting with the parcels below. The long form with all the reasoning is the [build plan document](../build.md); the design is the [kit page](../kit.md).

```ai Start here: paste this into your agent, it has everything needed to begin
You are a coding agent helping a person build a Life Box: a solar-powered 4G box with a Raspberry Pi 4 that recognises
birdsong on the spot (BirdNET-Go) and reads two soil probes, posting to the open life oracle at https://life.oncra.org.
Plan: https://life.oncra.org/lifebox  (one page per stage: /lifebox/0-before, /lifebox/1-bench ... /lifebox/5-soak; read the page you are on)
Repository: git clone https://github.com/oncra/life   (read content/build.md and node/README.md once; node/ is the software that runs in the box)
Ready-made SD-card image: https://github.com/oncra/life/releases/latest/download/life-node-v1.img.xz  (+ .sha256 beside it)
Machines: the person's laptop (Linux or macOS), and the node once it boots: ssh life@<NODE_HOSTNAME>.local, password "lifebox"
  unless life-node.env on the card sets NODE_PASSWORD or NODE_SSH_KEY. The stage pages use NODE=life@life-node-1.local; export it.
Oracle access: a place plus three device tokens (lo_dev_...). Either the maintainer (act@climatecleanup.org) gives you a place and
  a steward key, or you run your own oracle (README, "Run your own") and mint them with its ADMIN_API_KEY. Export LIFE_ADMIN_KEY.
Division of work: you type, check and record; the person plugs, reads the meter and decides. Ask before any command that
  writes a disk, switches power, or spends money. Never enable audio clip saving on the node. Never write a token into a file you commit.
Records: every measured number goes into kit/bench-log.csv (measured, date, notes columns) by pull request to oncra/life, or via the
  "AI change" button on the plan page if the person has its change code. Never change a modelled value.
Start: ask which stage they are on. If nothing is built yet, begin at https://life.oncra.org/lifebox/0-before, step 0.4.
```
