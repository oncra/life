---
title: "Sound stream: the bird protocols it follows"
summary: "The sound stream does not invent its own bird method. Which birds count comes from the farmland bird index of the Nature Restoration Regulation, which the EU carbon farming rules also name; how people count them from Sovon's farmland point counts; when BirdNET can be believed from TABMON's validation; how to share the data from Camtrap DP. Checked 19 October 2026."
order: 14.7
---

# Sound stream: the bird protocols it follows

Reading life from bird song is not new, and neither are the rules for doing it well. Four existing protocols each answer one question the sound stream has to answer, and the oracle follows them instead of writing a fifth.

| Question | Existing protocol | What the oracle takes from it |
| --- | --- | --- |
| Which birds count? | The common farmland bird index of the Nature Restoration Regulation, Annex V: 27 species for the Netherlands. The EU carbon farming rules name the same index as a biodiversity co-benefit | The species set for a farmland bird lane |
| How do people count them? | Sovon's farmland point counts (Meetnet Agrarische Soorten): 10 minutes per point, four rounds each spring | The visit for birds, and the yardstick for a node |
| When is BirdNET right? | TABMON's validation (Biodiversa+), after Wood and Kahl: experts check clips across the whole score range, and each species gets its own threshold at a set precision | A threshold per species instead of 0.7 for all |
| How is it shared? | Camtrap DP with the acoustic additions proposed by the Safe and Sound project, toward GBIF | The export format for a place's detections |

What is built today is the stream itself and the Diversity reading at one threshold for every species (sections 2.2 and 3.2 of the [specification](spec.md)). Everything below marked *specified* is the plan.

## 1. Which birds: the farmland bird index

The Nature Restoration Regulation, (EU) 2024/1991, obliges every member state to raise its common farmland bird index, computed from the species listed for it in Annex V and set at 100 on 1 September 2025 (Article 11(3)). The Netherlands is one of the states with historically more depleted farmland bird populations, so its index has to reach 110 by 2030, 120 by 2040 and 130 by 2050. The index is monitored every year (Article 20), and the regulation names in-situ sensors and artificial intelligence among the means of monitoring (Article 20(9)). In the Netherlands, Sovon and Statistics Netherlands (CBS) compute the farmland bird index from the national bird counts.

The 27 species for the Netherlands: skylark, meadow pipit, little owl, ruff, goldfinch, rook, common quail, yellowhammer, kestrel, common snipe, oystercatcher, icterine warbler, barn swallow, black-tailed godwit, corn bunting, western yellow wagtail, curlew, tree sparrow, grey partridge, stonechat, shoveler, turtle dove, starling, common whitethroat, redshank, mistle thrush and lapwing. The annex uses some older scientific names than the detector does, so the lane carries a table that maps one to the other.

The same index is written into the EU rules for certified carbon farming. The delegated act with the carbon farming methodologies (C(2026)4666, Annex, section 5.3) lets an operator report further sustainability co-benefits in one of two ways: by practice, or by result, "quantified by showing improvements against relevant sustainability indicators". Indicators used for a result must be "consistent with applicable indicators and methodologies under national and Union legislation", and the act names the Nature Restoration Regulation. Its examples for agriculture and agroforestry on mineral soils and for rewetted peatland include "an improvement in the farmland bird index"; for afforestation, "an improvement in the common forest bird index".

*Specified:* a farmland bird lane per place and per breeding season, on the Annex V species of the member state the place lies in. For each species it counts the share of listening minutes in which the species is heard from 1 April to 15 July (the spring of the farmland counts, section 2), from calibrated detections, and it combines the species' changes from one season to the next the way the national index does, as a geometric mean with its interval drawn by Monte Carlo. Not the days a species is heard: for a common species that is every day whether two pairs or ten sing, so days heard says how long a species is around, not how many there are ([what it measures](confidence.md), section 4). Two limits travel with it. The national index counts birds; a node hears whether a species sings or calls, not how many there are, so the lane is an index of vocal activity: the same species and the same season as the national index, not the same measurement. And some of the 27 are seen far more often than they are heard. Which of them a node can follow is something the first seasons will measure.

## 2. How people count them: Sovon's farmland point counts

Sovon's Meetnet Agrarische Soorten (MAS) counts the birds of farmland at fixed points: 10 minutes per point, at least five points per route, four rounds each spring (1 to 20 April, 21 April to 10 May, 11 May to 10 June, 21 June to 15 July), every species counted. Farmland is the habitat the Dutch counts reach least well, and Sovon has been testing recorders on exactly these points.

In a pilot in the Maasheggen and on the Schijndelse Heide, AudioMoth recorders ran during the counts. Small songbirds such as chaffinch, blackcap and chiffchaff came through well on the recordings; birds that counters mostly see, such as jay, wood pigeon and buzzard, were largely missing. BirdNET at a score of 0.5 or more named hardly any species wrongly, but it missed many: the blackbird, heard at 34 points, was not recognised once. At 0.05 it missed fewer and named many species that were not there. The full study (Roodbergen, Boom and Van Harten 2025) recorded 232 ten-minute counts at 13 farmland sites. Of 91 species, 65 were found both by the counters and on the recordings, and 7 only on the recordings. BirdNET 2.4 and Google's bird classifier scored best of the four models tested, and still, at one false alarm in a hundred, the models missed around six in ten of the birds present. Sovon's conclusion: BirdNET's results have to be checked by people, and the distance at which each species can still be heard has to be known before a recording can stand for an area.

*Specified:* the visit for birds (specification, section 2.4) is a MAS count at the node: 10 minutes, in each of the four MAS rounds, with the species list filed as the visit's findings. It is the ground truth for the node's species list, and the same pairing Sovon used in its own tests. A node at an existing MAS point could be compared with the counts that volunteers already make there.

## 3. When BirdNET is right: TABMON's validation

TABMON, the Transnational Acoustic Biodiversity Monitoring Network (Biodiversa+), has run 108 connected recorders in Norway, the Netherlands (18), France and Spain since the first months of 2025, and will run until at least January 2027. Researchers from Sovon, Naturalis, the University of Amsterdam, Tilburg University and Statistics Netherlands are among its authors. Its method for turning BirdNET's output into data follows Wood and Kahl (2024): a BirdNET score is not a probability, and one threshold for all species gives a very different precision for each of them. So experts check clips sampled across the whole score range for each species, a fixed number from 0.1 to 0.2, from 0.2 to 0.3 and so on. That gives a calibration curve per species, and the threshold is set where precision reaches a chosen level, 0.9 or 0.95. Above it, detections are summarised as presence or detection frequency per site and per day, season or year. TABMON publishes its detections and expert labels on Zenodo; the first release holds 2,000 labelled detections, from France and Norway.

The oracle's Diversity reading counts every species above one score, 0.7 (specification, section 3.2). Sovon's blackbird shows what that can cost: a common species missed at every point. *Specified:* a threshold per species at a precision of 0.95, set from clips that experts have checked, replacing the single 0.7. It starts with the Annex V species, which keeps the first round of checking to 27 species rather than every bird the detector knows. How that threshold is set so that it holds at a place, and why many thresholds come out lower than 0.7, not higher, is in [what it measures](confidence.md), section 2.

Validation needs sound, and the standard node sends none over the air. So the node keeps a sample of short clips on its own card, and a visit collects them by hand (decided 19 October 2026; specification, section 2.2). Only detections of bird and bat species qualify, only inside the listening windows, and a detection in which a speech detector hears a voice is dropped with its clip. For each species the node keeps at most five clips per month in every score band of 0.1, so that the checking covers the whole score range as TABMON's does. A clip is deleted from the node once a visit has copied it, and after twelve months if no visit has. The oracle never receives sound: a checker labels each clip as right, wrong or unsure, and only those labels go into the oracle's calibration register, from which the threshold per species is computed. Which tool the checkers listen with is chosen with the people who do the checking.

What the detector misses is not in any clip. That side comes from the MAS counts at the node (section 2): a species the counter finds and the node never reports is a miss.

## 4. How it is shared: Camtrap DP for sound

Camtrap DP is the exchange format for camera-trap data, maintained under TDWG, from which datasets are published to GBIF. The Safe and Sound pilot (Wiel et al. 2026, with TABMON) concluded that it suits passive acoustic data as well, and that no separate standard is needed. Its proposed additions (device fields and a recording schedule for deployments, sample rate and duration for media, frequency bounds for observations) are being tested on real datasets and logged as issues in the Camtrap DP repository. *Specified:* an export of a place's detections in that form, with the listening windows (specification, section 2.2) as the recording schedule and the detector, its version and its score on every observation, so that a place's detections can be published to GBIF beside TABMON's.

## What we did not take over

Acoustic indices as a stand-in for species richness: they relate to it only moderately and inconsistently (see [Prior art](prior-art.md), Ecoacoustics). And continuous recording with the audio uploaded to a server, which is how TABMON works: the right design for a research network with institutional bandwidth, the wrong one for a node that has to live ten years on one SIM card and does not send sound.

## Sources

Checked on 19 October 2026.

- Regulation (EU) 2024/1991 on nature restoration, Articles 11, 12 and 20 and Annex V: [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1991/oj).
- Commission Delegated Regulation C(2026)4666, Annex, section 5.3, as sent to the Council: [ST 11809/26 ADD 1](https://data.consilium.europa.eu/doc/document/ST-11809-2026-ADD-1/en/pdf).
- Sovon, [Meetnet Agrarische Soorten](https://www.sovon.nl/mas).
- Sovon (2023). [AudioMoths en het gebruik bij vogeltellingen](https://www.sovon.nl/sites/default/files/2024-02/PAM%20Sovon%20Nieuws%203-2023.pdf). Sovon-Nieuws 3-2023.
- Roodbergen, M., Boom, C. and Van Harten, N. (2025). Applying passive acoustic monitoring for Dutch common bird species: evaluating detection and classifier performance. *Bird Census News* 38: 14-25. [PDF](https://www.ebcc.info/wp-content/uploads/2026/02/roodbergen-et-al.pdf).
- Cretois, B. et al. (2026). TABMON: design and deployment of a transnational passive acoustic monitoring network for European birds. *Methods in Ecology and Evolution*. [doi:10.1111/2041-210x.70308](https://doi.org/10.1111/2041-210x.70308). Detections and labels: [Zenodo 17511368](https://zenodo.org/records/17511368).
- Wood, C. M. and Kahl, S. (2024). Guidelines for appropriate use of BirdNET scores and other detector outputs. *Journal of Ornithology* 165: 777-782. [doi:10.1007/s10336-024-02144-5](https://doi.org/10.1007/s10336-024-02144-5).
- Safe and Sound: [camera-traps/bioacoustics](https://github.com/camera-traps/bioacoustics), and [Camtrap DP](https://camtrap-dp.tdwg.org/).
