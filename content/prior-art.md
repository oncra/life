---
title: "Prior art: what exists, what is new"
summary: "A scan of credit methodologies, scientific condition frameworks, Dutch farmland indicator sets and sensor products, checked 2026-09-12, rechecked for devices on 2026-09-13 and for open-source alternatives on 2026-09-16, and an honest account of which parts of this design are borrowed and which are not."
order: 16
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

**Biodiversiteitsmonitor Melkveehouderij and Akkerbouw.** Seven to nine KPIs from farm records, no sensors. WENR report 2968 (2019) is explicit that a low score on one KPI must not be compensable by another and requires every KPI to meet its threshold; FrieslandCampina awards a points class only if the farm sits in range on all KPIs. An independent validation on about thirty Brabant farms (HAS, 2022 to 2024) found a weak but statistically significant positive correlation between KPI scores and birds and butterflies, and none with soil or water parameters. Stated precisely, because the distinction matters: administrative KPIs do carry some signal about farmland life, and they carry none about the soil and water underneath it. That study's own sourcing is thin, with no coefficients published; the better-evidenced Dutch criticism is CLM's mid-term review across more than 400 farms, which concluded the monitor is aimed at broad sustainability rather than at biodiversity.

**Open Bodemindex (OBIC).** Twenty-two soil indicators (nine chemical, nine physical, two biological, two on nitrogen retention; four water indicators added in December 2025 for the drinking-water partner), scored 0 to 1 by logistic curves, weighted so the lowest indicator counts most (1/(I+0.2), about five to one: a soft Liebig rule), then weighted across years (ln(12−y), the latest year about 2.4 times the tenth) and across categories by the log of their indicator count. Partial compensation by design; open source, GPL-3 (`nmi-agro/Open-Bodem-Index-Calculator`, 4.3.0 as of July 2026). Its inputs are a topsoil lab sample once in four years (Eurofins, Dumea, ALNN, delivered under a JoinData authorisation), the public field layers (BRP crop history, 1:50 000 soil map, groundwater class, compaction risk) and fifteen yes/no management questions. Nothing is measured between samples: drought and wetness stress, water retention and workability are modelled from soil type and groundwater class, and there is no sensor, sound or satellite input. What makes it matter here is the loop around it: a.s.r., the largest private owner of Dutch farmland (about 36,000 ha), gives tenants 10% off the lease for three years and 5% after that on condition that they share their data with the Stichting Open Bodemindex, share the score with a.s.r. and try to improve it; by December 2022 that covered 150 tenants on 3,200 ha. A score from an independent foundation is already a lease condition. The soil stream of a Life node measures the two quantities the OBI models (moisture and temperature at two depths, every twenty minutes) and could be its first measured witness; the route in is the foundation, not the app, since the calculator is open and the application has no inbound API.

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

### The open-source question, searched properly on 2026-09-16

The scan above asked which devices you can buy. This one asks the harder question: is there an open-source connected acoustic node we should adopt instead of building one? Four answers, and the shape of them decided the design.

**[Bugg](https://github.com/bugg-resources) is genuinely open hardware, and it is the closest thing to this node that exists.** Not just firmware: the organisation publishes PCB eCAD for the main, LED and microphone boards, 3D CAD for the enclosure and assembly tooling, cable specifications, `buggd` for recording and upload, a modified `buggOS`, and the web dashboard. It is proven at a scale nobody else has reached in Europe: **[TABMON](https://besjournals.onlinelibrary.wiley.com/doi/10.1111/2041-210x.70308)**, funded by Biodiversa+ and led by NINA, has 97 Bugg units deployed across forests and wetlands in several countries, streaming to a public dashboard at `tabmon.nina.no`, with the data pipeline and export interface open on GitHub. If the question were only "has someone solved connected bird acoustics in the field", the answer would be yes, and it would be Bugg.

Three things stop it being our node. The licence is **CC-BY-NC-SA 4.0, non-commercial**, which does not sit comfortably under a certification body that sells its service. The devices carry no CE or UKCA marking, and the project says plainly that commercial deployment "may require significant further investment and potentially design changes". And the architecture is the opposite of ours: Bugg **uploads raw audio** to cloud storage and classifies it there, which is what TABMON does with a GPU pipeline running BirdNET v2.4 via AvesEcho. That is a good design for a research network with institutional bandwidth. It is the wrong one here, because it breaks the ten-year SIM on the first day and because "no sound leaves the node" is a promise we want to be able to make to a landowner.

**[acoupi](https://github.com/acoupi/acoupi) is the software layer we have been hand-rolling, and it is GPL-3.0.** A Python framework for exactly this shape of device: record, run a classifier on the edge, manage what accumulates, and send messages to a remote server, on a Raspberry Pi with a USB microphone. The core was updated in August 2026 and there is an MQTT and Grafana companion. Its `acoupi_batdetect2` binding is the mature one; `acoupi_birdnet` exists but has not been touched since January 2025. Worth reading before writing any more node code of our own, and worth contributing the BirdNET side back to rather than duplicating.

**[HARK](https://hark.nz/) is the one to watch, and it is closed.** Purpose-built stainless-steel acoustic monitor, integrated solar, LiFePO₄ rated to charge at −20 °C, three microphones with direction finding, 192 kHz, Google's Perch v2 running entirely on-device, and results rather than audio syncing over 4G or mesh. The number that matters is **116 mW** while recording, inferring, transmitting and compressing at once, against roughly 5 W for a Raspberry Pi doing less. That is not an incremental difference, it is a different class of machine, and it comes from custom boards and custom low-level firmware, none of it open. No price is published and it is not available until later in 2026. If it ships at a sane price with an API, buying it for the sound stream would beat building.

**BirdNET-Go, which this node already runs, does more than we were using.** It publishes detections over MQTT, supports webhooks and the BirdWeather API, and exposes a Prometheus endpoint. Our own push client may be redundant, which is a simplification to test on the bench rather than a thing to keep maintaining.

The conclusion is narrower than "nobody has done this". Several people have done the hard parts, and two of them did it openly. What does not exist is a node that classifies at the edge, ships only detections over a connection cheap enough to run for a decade, carries a soil stream alongside the sound, and comes with a licence a certifying body can use. The gap is not acoustics. It is the combination, and the licence.

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
