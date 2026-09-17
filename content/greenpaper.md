---
title: "Green paper: an oracle for Life"
summary: "Why financing the return of nature is blocked by the cost of proving it, and how three cheap streams that are each unreliable alone become one reading you can pay against."
order: 1
---

# An oracle for Life

*Green paper, version 0.1, September 2026. Open for comment. Licence CC BY 4.0. Edit it on GitHub.*

## Why this exists

Restoring a piece of land is not the hard part. Proving that it worked is.

Showing that life is returning to a field means hiring people. An ecologist walks transects. Soil goes to a laboratory. Someone counts birds twice in a season. All of that is good work, and all of it costs hundreds to thousands of euros per place per year. A single environmental-DNA sample with its lab analysis runs at about €390. Having a year of sound recordings analysed costs €470 to €940 per recorder. Certifying soil carbon takes thirty or more cores from one field, and again five years later.

That cost decides who gets paid for nature, and almost nobody notices it doing so. When proving an outcome costs more than the outcome is worth, the outcome does not get funded. So money for nature collects at the top: a few large projects, in a few countries, with budgets that can carry a verification bill. The farmer with twelve hectares of peat meadow, the village with a stream, the family with a woodlot. Each of them is too small to measure, so each of them is too small to finance. The money for restoring nature is not the scarce thing. Affordable proof is.

Make the proof cheap and the shape of the whole field changes. Payments can follow a single field instead of a portfolio. A twelve-hectare farmer becomes fundable. Checking becomes continuous rather than a visit every five years. And because the answer is a number in a public place rather than a report in a drawer, a bank, a registry, a subsidy scheme or a piece of software can settle on it without anyone flying in.

That is what this project is for. The satellite reading costs nothing, at any size, anywhere on Earth. The box that listens and feels the soil costs about €687 and should last years, so a place pays something like a hundred and forty euros a year and no fee per hectare. Against several hundred euros for one survey visit, that is the difference between measuring one showcase project and measuring a whole region.

### The part that is easy to miss

Any ecologist will tell you, correctly, that none of these three streams can certify a place on its own. They are right. Greenness seen from orbit can be bought with a bag of fertiliser. A sound recorder hears what is near it and misses what is quiet. A soil probe knows one spot in one field. Published work is blunt about it: acoustic indices on their own do not reliably predict how many species live somewhere.

So here is the thing that makes the design work anyway. Think of three witnesses to the same event, none of them reliable alone. One was far away. One was distracted. One has a poor memory. You would not convict on any single account. But the three do not know each other and cannot compare notes, and when they separately describe the same thing, you start to believe it. Not because any witness got better, but because it is hard for three unconnected accounts to be wrong in the same direction at once. Every witness you add makes the coincidence less likely, quickly.

Faking one stream is easy. Faking all three at once, in step with the seasons, means making the field green, filling it with breeding birds and bats, and making the soil breathe like living soil. At that point you are not faking an ecosystem. You are growing one.

The same picture tells you what to do when the witnesses disagree, which is the second half of the idea. A contradiction is not a failure of the method. It is the method pointing at the one place where a human should go and look. That is why field visits here are not scheduled: they are triggered by disagreement, plus a small random draw so that nobody knows in advance who gets checked. Expensive measurement stops being the routine and becomes the exception, aimed where it is worth spending.

And it compounds. A court that has heard a thousand cases knows what an ordinary story sounds like; a court that has heard three does not. Every place that joins sharpens the reading of every other place, because a place is judged against its own history and against the crowd of neighbours on the same soil under the same weather. With ten places you can say something careful about one of them. With ten thousand, a dry summer is subtracted rather than mistaken for decline, a fertilised field stands out from a living one, and the method's own errors become countable. The cheap network gets more trustworthy as it grows. The expensive survey does not.

## The same problem, one level down

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

In the standard kit the last two are one device: the probes are wired into the listening box on the short leads they ship with, and that box carries both streams out over its own cellular link. There is no farm WiFi, no gateway and no monthly subscription in the design, because species recognition happens inside the box and only detections leave the field.

That is all the routine hardware. No traps, no lab samples on a calendar, no surveys. Field visits with soil cores, DNA samples or insect counts are not scheduled. They are triggered when the streams disagree, plus a small random draw so nobody knows in advance who gets checked.

### Why this has to be built rather than bought

Every part of that box is on sale today. Species recognition at the edge is a solved problem: a €289 BirdWeather PUC runs it for 6,424 species and publishes an open API. Cellular soil probes are ordinary: Farm21 sells one with the SIM included and a REST API. Solar power for a three-watt load is a commodity. On a live scan of the market on 2026-09-13 we could not find a single product that does all of it at once, and the pattern in the near misses is consistent. The listening boxes that are cheap speak WiFi, which most fields do not have. The one that speaks 4G ships audio rather than detections, so it costs €15 a month instead of €12 for ten years. The device with cellular and solar runs its inference in someone else's cloud. The soil probes that need no gateway are sold by the company that then holds the readings.

That is not an engineering gap. It is what the market is for. These devices are sold in order to deliver data into the seller's platform, so nobody has a commercial reason to build the one that delivers it into somebody else's, least of all into a public registry the landowner can read and fork. The missing product is missing because the thing it would enable, a place's own evidence belonging to the place, is not a product.

So the kit is part of the standard, not an accessory to it. About €687 in parts, a published bill of materials, and software anyone can audit or rebuild: [the kit](/docs/kit). The evidence behind the claim, device by device with prices and dates, is in [Prior art](/docs/prior-art) and the [hardware guide](/docs/hardware). If someone does sell the whole thing, we would rather buy it, and a correction by pull request is the fastest way to tell us.

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

**Several cheap witnesses beat one expensive one.** This is the courtroom in the introduction, stated mechanically. Every stream is a noisy witness of the same thing. When independent witnesses agree, the chance they are all wrong in the same direction is small and shrinks with each witness.

**Neighbours cancel the weather.** A dry summer makes every field in the region look worse. A place is never judged alone; it is judged against all the fields with the same soil and climate around it. The reference is the statistical crowd of neighbours, not a hand-picked site.

**History gives resilience today.** We do not wait twenty years for shocks. The satellite archive already holds the droughts. For any field we read how far it fell and how fast it came back each time. After installation, the recorder adds a second check: after a shock, does greenness come back alone (fertiliser) or does birdsong come back with it (life)?

**Confidence grows with time, not with more holes in the ground.** Nothing needs a return visit to become more certain. It needs the streams to keep agreeing.

## Carbon with fewer holes in the ground

Soil carbon is verified today with thirty or more cores per field every five years, the same burden for every field. That is backwards.

Carbon change follows from what the streams already see: satellite gives capture, the soil probe gives the breathing, satellite plus sound give removal (harvest, tractor hours). A simple model of those three estimates carbon change per field per season; cores calibrate it once per soil type. Version 0.1 of that model runs today, as a yearly range with every parameter carrying a low and a high: [How carbon is inferred](/docs/carbon).

**Let life set the carbon burden.** A place where diversity, structure, cycling and productivity all rise is accumulating carbon almost by definition. A place claiming carbon gain while life readings are flat or falling is the monoculture case, and that is where the cores belong. Sampling intensity is set by agreement between the life readings and the carbon claim. The life oracle becomes the risk model for the carbon oracle.

**Issue for the lower bound, release as confidence grows.** Carbon change is a range. Credits are issued for the bottom of it. Each season the streams keep agreeing, the range narrows and more releases, the way a vintage matures. Uncertainty costs the claimant time, not lab money, and rewards keeping the place alive for years.

## What it would take to pay a place

Cheap proof is only half of the argument; the other half is what the proof connects to. The money that already flows to
land stewards for ecological outcomes is large, slow and expensive to administer, while the market for biodiversity
credits specifically is tiny. So the aim is not a new credit. It is a published tariff paid on a verdict, per hectare per
season, with a connection payment so that nobody has to front the cost of being measured, and the balance released as
confidence grows. The design, its costs, and the three roles that must never be merged are in
[How a place could earn](/docs/money). It is a proposal, not an offer: nothing is being paid yet.

## Where Oncra fits

Oncra's registry is already a one-dimensional life oracle, for carbon: methodology, verification, buffer pool, vintages, public ledger. The structure is right and the dimension is too narrow. Two moves: add the life readings as gates on carbon credits (a removal that lowers Diversity, Cycling or Autonomy at the place does not certify), then lift the gates out as this standalone oracle, with the carbon registry as its first paying user. This site runs on its own server on purpose; the registry has to keep running flawlessly while this grows. Integration comes later, by API.

## What version 0.1 does and does not do

Does: registers places anywhere on Earth; computes the satellite stream for them (Sentinel-2, 2019 to now, cloud-masked, per polygon); reads Productivity and a first Resilience from it; accepts sound detections, acoustic indices and soil readings by API, including The Things Stack webhooks; publishes seven readings with confidence and maturity, and the verdict; estimates a yearly carbon balance as a range and what is issuable at its lower bound; documents hardware, installation and data delivery for a global network of volunteers and professionals.

Does not yet: compare a place against its neighbour crowd (the regional reference); compute acoustic indices server-side from audio; run the random-draw and triggered-visit scheduler; publish the self-drift ledger; calibrate the carbon model against cores, or use it as a gate on issuance. Each is specified in the [specification](/docs/spec) with its status.

## What would make this fail

- Monoculture gaming: handled by floors, not sums.
- Measurement colonialism: handled by local reference, humans inside the metric, forkable governance.
- Breeding gardeners: handled by the Autonomy reading.
- Leakage: handled by nested ledgers (specified, not built).
- The oracle becoming the goal: handled by self-audit and "unknown" as a real answer. Never fully solved. Watched, not fixed.

## Related work

A scan of credit methodologies, scientific condition frameworks, Dutch farmland indicator sets and sensor products, with an account of what here is inherited and what is new, is in [Prior art](/docs/prior-art). Short form: the weakest-link verdict has ancestors in water law, the IUCN Red List of Ecosystems and the Dutch Biodiversiteitsmonitor; the fused three-stream verdict, disagreement-triggered visits, the published drift ledger and a single field device carrying all three streams into an open registry do not.

## Join

Register a place. Put a recorder on a post. Sink a probe. Propose a change to a reading. All of it is at [github.com/oncra/life](https://github.com/oncra/life).
