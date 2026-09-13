---
title: "Prior art: what exists, what is new"
summary: "A scan of credit methodologies, scientific condition frameworks, Dutch farmland indicator sets and sensor products, checked 2026-09-12 and rechecked for devices on 2026-09-13, and an honest account of which parts of this design are borrowed and which are not."
order: 15
---

# Prior art

Checked on live pages on 2026-09-12. The purpose is to say plainly what this design inherits and what it adds, so that the standard can cite its ancestors and defend its differences. Corrections by pull request are welcome.

## The short version

Four of our rules have clear ancestors. Six do not, as far as we could find.

| Rule in this design | Ancestors | Status |
| --- | --- | --- |
| Weakest-link verdict (no weighted sum) | EU Water Framework Directive "one-out-all-out"; IUCN Red List of Ecosystems ("the highest level of risk returned by any criterion"); Ecosystem Integrity Index (Hill et al. 2022: minimum of structure, composition, function); SDG 15.3.1; the Dutch Biodiversiteitsmonitor (all KPIs must clear their threshold, FrieslandCampina points only if every KPI is in range); UK BNG trading rules; CreditNature's geometric mean as the soft form | **Prior art** in regulation and science. Absent from sensor-based nature monitoring products, and explicitly rejected by Verra's Nature Framework ("a simple mean prevents indicators from forcing overall quality to zero") and by WUR's BLN 2.0 for soils |
| Unknown as a first-class answer | IUCN "Data Deficient / Not Evaluated"; EPA NARS "Not Assessed"; WFD "unknown" status class | **Partly prior art.** New here: unknown propagates to the verdict as "insufficient, do not pay", instead of being replaced by a proxy (Verra) or treated as zero change (Plan Vivo) |
| Judged against the place's own history and a neighbour crowd | RIVPACS/AUSRIVAS observed-over-expected against predicted reference sites (the canonical version); Biome Makers' percentiles against its database; WFD reference conditions | **Prior art**, applied here to per-parcel satellite phenology and soundscapes rather than to river invertebrates |
| Confidence and maturity per reading | Accounting for Nature's accuracy tiers (80/90/95%); Sylvera's rating ranges; WFD's duty to report confidence and precision | **Partly prior art.** Maturity (how long a direction has held) as a first-class field is ours |
| Three streams fused into one site verdict (satellite, acoustics, soil probe) | Pivotal and Landler run several streams but report metrics side by side; ARISE has the sensor stack without a site verdict; Groenmonitor has the satellite stream without thresholds; BioMonitor4CAP runs all of them in research | **Not found.** Nobody publishes a fused site verdict from these three streams |
| Life as the sensor: birds and bats as the insect reading, breeding song as renewal, machine noise as autonomy | Sentinel-species literature (Clark-Wolf 2024; Hazen 2024); Sethi 2023: soundscape change tracks community change even when indices do not predict richness | **Framing is new**; the science underneath is established |
| Field visits triggered by disagreement between streams, plus a random draw | Adaptive sampling literature (Mondain-Monval 2024; active learning); Savimbo audits a random subset of observations; IAPB asks for triangulation when the data collector is the beneficiary | **Not found as a framework rule** |
| A published ledger of the method's own drift | BeZero's annual rating transition study and versioned methodologies; Sylvera's locked framework versions; WFD intercalibration | **Not found in nature monitoring.** Carbon-credit rating agencies are the nearest |
| One field device that carries all three streams to an open registry | Rechecked against the live market on 2026-09-13. Listening: BirdWeather PUC (€289, BirdNET on the device, public API, no subscription, WiFi only); EasyComp Zeeland Watch House Field Pro (€245 plus €15/month for 10 GB, 4G and solar, ships audio rather than detections); Bugg v4 (cellular and off-grid solar, but cloud inference, hardware only, no published price); Haikubox and Song Meter Micro 2 (consumer WiFi, and an SD-card recorder). Soil: Farm21 FS31 (€375 plus €89 per sensor per year, NB-IoT with the SIM included, REST API); SenseCAP S2105 and Sensoterra (LoRaWAN, gateway required) | **Not found.** Every product covers one stream. Each one either keeps the readings in the vendor's cloud or on a card in a field. Nothing combines species detection at the edge, wired soil probes and a cellular link frugal enough to live on a ten-year 500 MB SIM, and nothing posts to a registry the owner of the land can read |
| A one-click multi-sensor set for landowners with open data | Chirrup (posted recorder, acoustics only, price on request); EasyComp Zeeland BirdNET boxes (€110 to €245); Faunabit DIOPSIS (lease, price on request); Pivotal (enterprise only) | **Not found.** In the Netherlands roughly 1,045 BirdWeather stations and 1,600 Sensor.Community sites already exist, so an open kit lands in a populated ecosystem |

## Credit methodologies

**Verra SD VISta Nature Framework v1.0 (Oct 2024).** Quality hectares = extent times condition; at least three composition and two structure indicators; arithmetic mean within and across components, geometric mean rejected on record; reference from the best reference site or model; missing indicators replaced by a correlated proxy; matched-control baselines; verification at least every five years. Fully compensatory.

**Plan Vivo PV Nature v1.2 (Apr 2026).** Five pillars including a Sentinel-2 NDVI "habitat health" metric and a five-yearly connectivity metric; multimetric is the cumulative sum of year-on-year changes; explicitly no reference sites; changes inside the 95% confidence interval count as zero; a correction factor is applied if measurement accuracy shifts. Compensatory.

**Wallacea Trust V3.** Basket of at least five metrics, median of the percentage changes; the reason for the median is not given in any document we could read.

**Savimbo ISBM.** Hectare-months times integrity, capped sums, indicator species from two kingdoms, eDNA excluded, an independent panel checks a random subset of observations. The only random-audit rule found.

**CreditNature NARIA.** Four metrics 0 to 100 against an attainable maximum, combined by geometric mean, so a weak metric drags the index. Accredited by Accounting for Nature, whose Econd carries accuracy tiers.

**UK statutory BNG.** Units cannot be summed across area, hedgerow and watercourse, and high-distinctiveness losses must be replaced like for like. Non-compensatory across bands, compensatory within.

**IAPB, Biodiversity Credit Alliance, the EU nature-credit roadmap (COM(2025) 374), Australia's Nature Repair Market.** All four reject a single fungible score. The BCA states the motive in one sentence: multiple metrics "to ensure that project interventions aren't causing one aspect of biodiversity to benefit while harming others." The weakest-link verdict is that sentence written as a rule.

## Scientific frameworks

**Essential Biodiversity Variables (GEO BON).** Twenty-one variables in six classes, deliberately not aggregated; satellite phenology and primary productivity are EBVs, there is no acoustic EBV.

**SEEA Ecosystem Accounting (UN 2021).** Variables rescaled against a reference condition, then aggregated; the text is agnostic on the rule and names the minimum operator ("one out, all out") as a precautionary option used in the Habitats Directive and the IUCN Red Lists, while noting that arithmetic means let a lost bird community be compensated by deadwood.

**Ecosystem Integrity Index (Hill et al. 2022; Ecological Indicators 2026).** Per 1 km cell the minimum of structure, composition and function, then down-weighted by the other two, "because the integrity of an ecosystem cannot be higher than the minimum score from any of the three components." The closest single precedent for our verdict rule.

**Water Framework Directive.** Ecological status is "the lower of the values" across quality elements. Twenty years of critique (Moe 2015; Prato 2014; Borja 2014) say the same thing: one-out-all-out over-reports failure when individual indicators are uncertain, and the error grows with that uncertainty. Keith et al. 2013 add the mirror risk: a minimum rule under-estimates when the limiting indicator is the one you lack. Our answer to both is confidence per reading and an unknown state that blocks the verdict instead of passing it.

**Ecoacoustics.** Alcocer et al. 2022 (meta-analysis, 34 studies): acoustic indices relate to biodiversity moderately and inconsistently (r about 0.33). Sethi et al. 2023 (8,023 recordings with paired point counts): neither indices nor machine learning predicted species richness across datasets, but soundscape change was consistently indicative of community change. That is why this design reads direction over time at one place, not level, and why visits remain the ground truth.

**Spectral diversity (Rao's Q).** Open R packages exist; results across habitats are ambiguous; no published framework pairs satellite spectral diversity with acoustics as joint condition streams.

## Dutch farmland indicator sets

**Biodiversiteitsmonitor Melkveehouderij and Akkerbouw.** Seven to nine KPIs from farm records, no sensors. WENR report 2968 (2019) is explicit that a low score on one KPI must not be compensable by another and requires every KPI to meet its threshold; FrieslandCampina awards a points class only if the farm sits in range on all KPIs. An independent validation on about thirty Brabant farms (HAS, 2022 to 2024) found only weak correlation between KPI scores and birds or butterflies and none with soil or water life: the strongest field evidence we found for measuring behaviour rather than inputs.

**Open Bodemindex (OBIC).** Twenty-one soil indicators, scored 0 to 1, weighted so the lowest indicator counts most (a soft Liebig rule), then weighted across years and categories. Partial compensation by design; open source, GPL-3.

**BLN 2.0 (WUR 2023).** Considered one-out-all-out for soils and rejected it because "in most cases soil quality would be judged insufficient", preferring classes over a grade.

**Farmland Bird Index.** Geometric mean of species trends; compensatory by construction.

**ARISE and Automated Biodiversity Monitoring (Naturalis, TNO, RIVM, Rijkswaterstaat; €19.4 M, 2026 to 2030).** The national sensor stack (acoustics, insect cameras, radar, eDNA), institution-hosted, no site verdict, no landowner route.

**Carbon MRV (SNK).** Soil carbon certificates are issued on the model (RothC) with measurement at year 0 and 10, because measured change is within lab error; a model version is frozen per project. The nearest Dutch precedent for "issue for the lower bound, release as confidence grows".

## Sensor products and services

No one sells a landowner-facing, install-once, multi-sensor set with a published price and open data. Single-modality services exist: Chirrup (bird recorder posted to the farm for 14 to 21 days, a "biodiversity score" with undisclosed method, price on request), Wilder Sensing (analysis of your own recorders, £400 to £800 per recorder per year), AgriSound Polly (insect acoustics, price on request), NatureMetrics (eDNA kits at £335 including lab, and a 0 to 100 Ecosystem Condition Index for UK rivers), Faunabit DIOPSIS (insect camera, buy or lease, price on request). Pivotal integrates cameras, acoustics, drones, eDNA and satellite for enterprise clients and keeps the metrics separate. Carbon MRV firms (CarbonSpace under $5/ha, Kanop with per-pixel confidence intervals) publish uncertainty but not biodiversity.

### Devices you can buy today, rechecked 2026-09-13

The question behind this scan is whether the kit could simply be bought. For each half of it, separately, almost. For the whole of it, no.

On the listening side several products already do what the node's Raspberry Pi does, and two of them do it better. The **BirdWeather PUC** (€289 at Veldshop, NL) runs BirdNET on the device for 6,424 bird species plus frogs and some insects, publishes a public API and a CSV export, and charges no subscription. It is the closest thing to a reference implementation of this half of the design, and this oracle already polls it. Its single constraint is the one that shaped the whole node: it speaks WiFi and nothing else, and most fields have no WiFi. **EasyComp Zeeland's Watch House Field Pro** (€245, "coming soon" on the day of checking) does add 4G and a 10 to 20 W panel, at €15 a month for 10 GB. That price is the architectural argument in one line: their box ships audio, this one ships detections, which is why a €12 SIM lasts ten years here. **Bugg v4** has the cellular link and the off-grid solar but runs inference in the cloud, is sold by pre-order through GroupGets, publishes no price, and states plainly that it currently provides hardware and not analyses or dashboards. **Haikubox** ($399 with five years included, $59 a year after) is a closed consumer platform on WiFi. The **Wildlife Acoustics Song Meter Micro 2** (about $202) is a recorder, not a monitor: no link, no classification, a card to fetch. **RFCx Guardian 3** is solar and cellular and real-time, but it is built for chainsaw detection and distributed through programmes rather than sold. **Microsoft SPARROW** (Jetson Orin Nano plus Starlink) and **Bird@Edge** (ESP32 microphone nodes reporting to a Jetson base, about €110 in parts) are open reference designs rather than products, and both are worth reading before anyone builds a v2 board.

On the soil side there is one product that could replace this half of the node outright. **Farm21's FS31** (€375, plus €89 per sensor per year) has NB-IoT and LTE-M with 2G fallback and the SIM included, needs no gateway, runs about a year on a charge, reads moisture at 0 to 10, 10 to 20 and 20 to 30 cm and temperature at two depths, and publishes a REST API. Against two €26.90 wired probes it costs about €280 more up front and €89 a year, and it puts a company between a place and its own readings. **SenseCAP S2105** (€129.99 excluding VAT) and **Sensoterra** (price on request) are both LoRaWAN, which means the gateway this design was built to avoid.

What none of them do is the combination. There is no product that hears, reads the soil, carries both over one cellular link, and posts the result to a registry that the landowner and anyone else can read. The nearest buyable approximation is a PUC plus an FS31, roughly €664 and €89 a year, and it fails at the first field without WiFi. Adding a 4G router to rescue it reconstructs the €1,110 distributed set this kit replaced.

Free-kit programmes for farmers exist only for air quality (Boer aan het Roer, Snuffelfiets); biodiversity hardware stays with institutes (DIOPSIS, AgZero+, BioMonitor4CAP) or is paid by a corporate buyer (Pilgrim's with Chirrup). Farmers in BioMonitor4CAP flagged data privacy and theft as the two recurring problems.

## The closest working precedent: Acorn

Everything above is about how condition is defined. This section is about what happens when someone actually pays land
stewards on remote sensing at scale, because exactly one organisation has done it in large numbers and its record is
public. Read on 2026-09-13 from the methodology modules, five audit reports and the Verra and Plan Vivo registries rather
than from press coverage.

**What it is.** Acorn B.V. (Utrecht, a wholly owned Rabobank subsidiary) runs a carbon programme for smallholder
agroforestry: **591,761 farmers, 555,559 ha, 487,196 t CO₂ and €8.8M paid to farmers** as published in September 2026,
running since 2019 or 2020. Certified by Plan Vivo, whose library carries Acorn's method as PM002 v1.0 (active 29
September 2025, reviewed by Plan Vivo's technical panel and AENOR). Two Verra projects exist under VM0047, both still in
validation with no credits issued.

**How it measures.** Above-ground biomass density per plot from Sentinel-2 at 10 m fused with Sentinel-1, with airborne
LiDAR or GEDI for structural calibration, through a machine-learning regression whose architecture is not published.
Below-ground is inferred from a root-to-shoot ratio; **soil carbon is excluded**. Ground truth is 1-ha plots measured by
the local partner at an intensity of **at least 30 plots per ecoregion, refreshed every five years**, not per project and
not per farm. Verification is at programme level on a statistical sample of projects; under their sampling procedure
credits may be issued before any third-party audit, and validation happens once per project.

**What we adopt from it.** Calibrating the stratum rather than the site, and auditing a sample of the programme rather
than every place every year. Those two moves are why verification can stop scaling with the number of farms, and they
appear in this design as the neighbour crowd and the random draw.

**What the audits found, twice.** In Côte d'Ivoire (Preferred by Nature, 30 June 2022) the credits were found to
overestimate removals more than sixfold. The causes were a planting density assumed at 50 trees per hectare where the
auditor counted about six; two remote-sensing partners applying the same model to the median pixel and to every pixel
respectively, with identical accuracy statistics and materially different biomass; ground truth too sparse for outlier
detection; and a calculation the auditor could not reproduce. Underneath sat range compression: the partner's own table
shows training data reaching down to 0.03 t/ha while the model's predictions bottomed out at 3.5, which is precisely the
newly-planted case.

In Kenya (Preferred by Nature, 11 July 2024) the same defect appeared in a form that names the general problem: the
biomass change claimed was 10.73% of the stock while the model's permitted error was 30%, so the error was 2.63 times
larger than the signal, and the verifier concluded that the real uncertainty "is not being addressed".

Three further findings matter for anyone designing a payment system. The **ground truth** was the part that failed
audit, not the satellite: a Kenyan verification re-measured plots and found trees grouped by a rule absent from the
protocol, heights measured incorrectly, 60% and 18% more trees counted than the project had, and results 2.6 times
lower overall. In **four of five audited projects farmers had not been paid at the time of audit**, one of them still
unpaid at re-validation two years on, with one project's entire grievance log being about payment timing. And a
**government claim** ended the Ivorian project: the state asserted that credits from 2020 to 2024 belonged to it under a
2021 decree, the area already being inside a World Bank programme; issuance froze at 122,457 units across roughly 16,200
farmers and no public resolution exists.

**Why their stated accuracy floor does not protect much.** The rule is R² of at least 0.7 and normalised error of at most
30%. The error is normalised by the range of the calibration set rather than its mean, so on a set running 0.03 to 463.5
t/ha that permits an absolute error near 139 t/ha on plots holding about 7. The uncertainty deduction takes a quarter of
whatever exceeds 50%, which in the approver's own worked example turns 70% uncertainty into a 5% deduction. And the
uncertainty term is built on the standard error of the mean, so adding calibration plots lowers every prediction's
reported uncertainty without the model improving.

None of this is a reason to dismiss the programme. It is the most valuable body of evidence available to anyone building
in this space, it is public because its certifier and auditors published it, and the methodology was rewritten in
September 2025 to address much of it. It is the direct source of the nine measurement rules in the
[specification](/docs/spec), section 5b. The general lesson is the one this whole design is built around: a single
number with no second witness, carrying a payment, fails in exactly this way, and the failure is invisible until someone
walks the field.

## What this means for the standard

- Cite the ancestors: WFD, IUCN RLE, EII and the Biodiversiteitsmonitor for the verdict rule; RIVPACS for the reference crowd; Accounting for Nature and WFD for confidence reporting; Sethi 2023 for direction-over-level.
- Own the critique: the known failure of one-out-all-out is over-reporting failure under uncertainty. This design's confidence and unknown fields are the mitigation, and the drift ledger is how we will find out whether it works.
- The four claims we make as new, and will defend until someone shows prior art: a fused three-stream site verdict; disagreement-triggered visits with a random draw as a framework rule; a published self-audit of method drift in nature monitoring; and a single field device that carries species detection, soil and a cellular link into an open registry, which on a live market check no vendor sells.

## Sources not reachable today

Verra and Plan Vivo pages intermittently blocked; Wallacea's methodology PDF is form-gated; ISC Victoria PDF; NINA/TABMON; Chirrup and Faunabit prices are not published anywhere we could reach. Listed so that the next pass knows where to look.
