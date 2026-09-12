---
title: Green paper: an oracle for Life
summary: Why a living place needs its own way of answering, and how three cheap data streams become seven readings and one verdict.
order: 1
---

# An oracle for Life

*Green paper, version 0.1, September 2026. Open for comment. Licence CC BY 4.0. Edit it on GitHub.*

## The problem in one paragraph

Everything that gets optimised hard needs a cheap, fast, hard-to-fool way of knowing whether an attempt worked. Software has the compiler. Finance has the ledger. Carbon has, slowly and expensively, grown registries. Life has nothing. A field that is quietly becoming a living system and a field that is quietly dying look the same on every balance sheet, and so money, policy and increasingly software agents optimise against proxies for life (tons of carbon, trees planted, hectares "restored") and get the proxy without the thing: eucalyptus for carbon, a dead watershed for free. This paper describes a different structure. Not a better metric, but a way for the place itself to answer.

## What an oracle is, and why life does not have one yet

An **oracle** is anything that tells you, cheaply and reliably, whether an attempt succeeded. It has three properties that matter: what it costs, how long it takes, and how hard it is to fool. A compiler is free, instant and nearly unfoolable. That is why software was automated first.

Every oracle is a **proxy**: a stand-in for what you actually want. Optimise against it hard enough and you get the proxy without the thing (Goodhart's law). The force of that law grows with optimisation pressure, and agents are optimisation pressure at a scale never seen before.

Life fails the three tests at first sight. It is slow. It is not a number. And every single number anyone has proposed for it gets gamed the moment money points at it. So the design cannot be a better metric. It has to be a different structure.

The clue is in why the software oracle works. The compiler has no opinion about the code. It runs it, and the code answers for itself. A life oracle should, as far as possible, be **life answering for itself**: not human judgement about a place, but the measured behaviour of the living system in that place. Only life can tell you whether life is thriving.

## Design principles

1. **Measure life's behaviour, not our inputs.** Not trees planted, hectares restored, money spent. Whether the living system persists, renews, diversifies, builds structure, closes its cycles and self-regulates. Inputs are what people control and therefore what people game.
2. **A vector with floors, never a sum.** Weighted sums are the gaming surface: you buy one dimension with another. The oracle returns several readings and the verdict is the weakest of them. This single rule kills the monoculture-for-carbon failure.
3. **Relative to the place's own potential.** A desert is not a failed rainforest. The reference is the place's own history plus the crowd of neighbours on the same soil and climate. The verdict is direction, not level.
4. **Layered in time, like tests.** Cheap fast signals issue provisional readings. Slow integrators confirm or revoke. Readings mature: a direction that has held for three seasons is worth more than a fresh one.
5. **Life as the sensor.** Organisms integrate conditions no instrument does. Birds and bats are the insect sensor. Breeding song is the renewal sensor. Soil breathing is the cycling sensor.
6. **Make faking costlier than doing.** Fooling one stream is easy: fertiliser makes a field green. Fooling all of them at once, in step with the seasons, is growing an ecosystem. Disagreement between streams is the fraud signal and the error signal at once.
7. **Nested ledgers.** Plot, landscape, bioregion, planet. Local gains that export loss elsewhere are caught at consolidation.
8. **Unknown is a first-class answer.** Confidence travels with every reading, and low confidence blocks money.
9. **Humans are a population in the place.** A life oracle that leaves humans out is optimised by removing them.
10. **Reward self-organisation, not intervention.** A place that holds its state with little management scores at least as well as one held up by constant care. Otherwise the oracle breeds gardeners and kills the wild.
11. **The oracle measures its own drift.** Every method version is scored later against what actually happened. The gap is published and used to revise the method.
12. **A commons, versioned and forkable.** Methods, data and code are open. Anyone can rerun a verdict. Who writes this oracle is a constitutional question, so the answer cannot be one company or one state.

## The simplified design: three streams, no routine sampling

A good doctor does not biopsy every organ at every visit. She reads pulse, temperature, colour, breathing. Each sign is cheap and imprecise alone. Together they are very hard to fool, because a sick body cannot make all of them look healthy at once. The biopsy is ordered when the cheap signs disagree.

The oracle works the same way.

**Satellite.** Free, every few days, with an archive back to 2017 at ten metres and to 1984 at thirty. It sees how green the land is and when, how long the growing season lasts, how many days the soil lies bare, and how far a place fell and how fast it came back in the droughts of 2018, 2020 and 2022. This stream runs for every registered place from day one, computed by this software from Copernicus Sentinel-2 without any account or key.

**A sound recorder.** A box the size of a paperback, one per roughly twenty hectares, installed once. It hears birds, singing insects, bats, frogs, and also tractors and pumps. Bird calls are identified automatically by software that exists today. Birds and bats eat insects, so their numbers and breeding track the insect supply without catching a single insect. Machine noise tells you how much management a place needs.

**A soil probe.** A stick in the ground per field, installed once. Moisture and temperature, and from those the rate at which the soil is breathing.

That is all the routine hardware. No traps, no lab samples on a calendar, no surveys. Field visits with soil cores, DNA samples or insect counts are not scheduled. They are triggered when the streams disagree, plus a small random draw so nobody knows in advance who gets checked.

## Seven readings, one verdict

| Reading | What life is doing | Read from |
| --- | --- | --- |
| Productivity | capturing energy, building biomass | satellite greenness over the growing season |
| Diversity | differentiating into many forms | species heard per year |
| Structure | building trophic levels and habitat complexity | acoustic indices (soundscape balance) |
| Renewal | reproducing and recruiting | breeding-season song |
| Cycling | closing water and nutrient loops | soil breathing from moisture and temperature |
| Resilience | recovering after disturbance | drought years in the satellite archive |
| Autonomy | holding its state with little external input | machine noise, inputs per hectare |

Each reading is **rising, holding, falling or unknown**, with a confidence (0 to 1) and a maturity (how many periods the direction has held). The verdict is the weakest reading: **thriving** only if nothing falls and confidence is high, **holding** if nothing falls, **declining** if anything falls, **insufficient** if anything is unknown. Human wellbeing enters as a population inside Diversity, Renewal and Resilience (from public regional statistics at first), not as an eighth axis it could be traded against.

## How confidence comes from combining

**Several cheap witnesses beat one expensive one.** Every stream is a noisy witness of the same thing. When independent witnesses agree, the chance they are all wrong in the same direction is small and shrinks with each witness.

**Neighbours cancel the weather.** A dry summer makes every field in the region look worse. A place is never judged alone; it is judged against all the fields with the same soil and climate around it. The reference is the statistical crowd of neighbours, not a hand-picked site.

**History gives resilience today.** We do not wait twenty years for shocks. The satellite archive already holds the droughts. For any field we read how far it fell and how fast it came back each time. After installation, the recorder adds a second check: after a shock, does greenness come back alone (fertiliser) or does birdsong come back with it (life)?

**Confidence grows with time, not with more holes in the ground.** Nothing needs a return visit to become more certain. It needs the streams to keep agreeing.

## Carbon with fewer holes in the ground

Soil carbon is verified today with thirty or more cores per field every five years, the same burden for every field. That is backwards.

Carbon change follows from what the streams already see: satellite gives capture, the soil probe gives the breathing, satellite plus sound give removal (harvest, tractor hours). A simple model of those three estimates carbon change per field per season; cores calibrate it once per soil type.

**Let life set the carbon burden.** A place where diversity, structure, cycling and productivity all rise is accumulating carbon almost by definition. A place claiming carbon gain while life readings are flat or falling is the monoculture case, and that is where the cores belong. Sampling intensity is set by agreement between the life readings and the carbon claim. The life oracle becomes the risk model for the carbon oracle.

**Issue for the lower bound, release as confidence grows.** Carbon change is a range. Credits are issued for the bottom of it. Each season the streams keep agreeing, the range narrows and more releases, the way a vintage matures. Uncertainty costs the claimant time, not lab money, and rewards keeping the place alive for years.

## Where Oncra fits

Oncra's registry is already a one-dimensional life oracle, for carbon: methodology, verification, buffer pool, vintages, public ledger. The structure is right and the dimension is too narrow. Two moves: add the life readings as gates on carbon credits (a removal that lowers Diversity, Cycling or Autonomy at the place does not certify), then lift the gates out as this standalone oracle, with the carbon registry as its first paying user. This site runs on its own server on purpose; the registry has to keep running flawlessly while this grows. Integration comes later, by API.

## What version 0.1 does and does not do

Does: registers places anywhere on Earth; computes the satellite stream for them (Sentinel-2, 2019 to now, cloud-masked, per polygon); reads Productivity and a first Resilience from it; accepts sound detections, acoustic indices and soil readings by API, including The Things Stack webhooks; publishes seven readings with confidence and maturity, and the verdict; documents hardware, installation and data delivery for a global network of volunteers and professionals.

Does not yet: compare a place against its neighbour crowd (the regional reference); compute acoustic indices server-side from audio; run the random-draw and triggered-visit scheduler; publish the self-drift ledger; model carbon. Each is specified in the [specification](/docs/spec) with its status.

## What would make this fail

- Monoculture gaming: handled by floors, not sums.
- Measurement colonialism: handled by local reference, humans inside the metric, forkable governance.
- Breeding gardeners: handled by the Autonomy reading.
- Leakage: handled by nested ledgers (specified, not built).
- The oracle becoming the goal: handled by self-audit and "unknown" as a real answer. Never fully solved. Watched, not fixed.

## Join

Register a place. Put a recorder on a post. Sink a probe. Propose a change to a reading. All of it is at [github.com/oncra/life](https://github.com/oncra/life).
