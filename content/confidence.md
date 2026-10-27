---
title: "Sound stream: what it measures, and how sure we are"
summary: "What a detection actually is, which claims about birds and bats it can carry, and the statistics that give each claim a confidence level: a calibrated threshold per species, presence as a probability, activity instead of days heard, numbers of birds only with counts beside the nodes, and money on the lower bound. With a first calibration run on TABMON's open expert labels. Checked 27 October 2026."
order: 14.8
---

# Sound stream: what it measures, and how sure we are

Anyone who pays for a bird on the strength of a Life Node will ask two things: what does the node actually measure, and how sure can we be? This page answers both, in the order the evidence builds up. In short: a node measures **vocal activity that reached its microphone and that the detector recognised**. That is not a number of birds. Checked clips turn it into a species' presence with a known probability. A fixed listening effort turns it into an activity index with a confidence interval. Only point counts beside many nodes turn it into birds per hectare. For bats the ceiling is lower.

It builds on [the bird protocols](bird-protocols.md), which say which birds count and how people count them, and on Wood and Kahl (2024), the guideline for BirdNET scores. Everything marked *specified* is the plan; section 9 lists it.

## 1. What a detection is

BirdNET scores every three seconds of sound, for every species it knows, between 0 and 1. A detection is a three-second window in which one species' score passed the node's threshold. How many detections of a species a node makes in a listening window is the product of four things, plus a fifth that has nothing to do with the bird:

| Factor | Varies with | What pins it down |
| --- | --- | --- |
| How many birds are within hearing | the quantity anyone wants | section 5 |
| How often each one sings or calls | species, date, hour, weather, breeding stage, and the density itself | the fixed listening windows ([specification](spec.md), 2.2); models across nodes |
| Whether the sound reaches the microphone | distance, habitat openness, wind, background noise, how the node is mounted | playback and counts at visits (section 5) |
| Whether the detector names it above the threshold | species, distance, noise, the threshold | point counts beside the node; checked sound (section 2) |
| False detections | other species, noise, the detector's own mistakes; the place, the month, the model version | checked clips (section 2) |

Wood and Kahl's calibration deals with the last row only. The first row is what finance wants. Everything in between is why a node's detections are not a count, and why the steps below are needed before they become one.

## 2. Calibration: from a score to the chance a detection is right

A BirdNET score is not a probability, and the same score means a different thing for every species. Wood and Kahl's remedy, which the Life Oracle adopted on 19 October 2026: an expert checks clips across the whole score range, a logistic regression of right or wrong on the logit of the score gives each species its own curve, and the threshold is the score at which a detection is right with a chosen probability, 0.9, 0.95 or 0.99. The node keeps the clips for this ([specification](spec.md), 2.2): at most five per species, per month and per score band of 0.1. Five refinements decide whether the result can carry money.

**Two kinds of 0.95.** Wood and Kahl's threshold is the score at which *one* detection has a 0.95 chance of being right; every detection above it is better. What a presence or an activity count needs is the precision of the *whole set* that is counted: of all detections above the threshold, how many were right. That threshold is always lower. On Wood and Kahl's own sample (200 checked Phainopepla clips) a single detection reaches 0.95 at a score of 0.754, while all detections together reach 0.95 from 0.49 up. Across 19 species in British Columbia, a set precision of 0.9 kept 70% of the detections on average, at thresholds mostly below 0.35, where a flat 0.7 kept 17% (Tseng et al. 2025). The set precision has to be computed with weights: the node checks five clips per band whether a band held ten detections or a thousand. *Built:* the node now writes how many detections each month's clips were drawn from, per species and band (`bands.csv`, next to the clips), so the oracle can weight them.

**A threshold has an error bar.** A threshold stable to within 0.05 took about 154 checked clips per species (89 to 218), and an interval narrower than 0.1 about 204, in a study of 72 European species; its authors advise about 250 (Scanferla et al. 2025). We simulated the node's own design on Wood and Kahl's curve: a threshold estimated from n clips delivers less than the promised 0.95 about half the time, at any n, because it is an estimate. From 45 clips (one node, one month) almost a quarter of the estimated thresholds deliver less than 0.90. Taking the upper end of the threshold's one-sided 95% interval instead cut the share that delivered less than 0.95 to 7 to 14%; it kept 60% of the right detections at 45 clips, 77% at 180 and about 90% from 360. For a species that is nearly always right, plain counting is simpler and needs no curve: 59 checked clips that are all right prove a precision of at least 0.95 (one-sided, 95% confidence), 93 with one wrong, 124 with two wrong; for at least 0.90, 29, 46 and 61.

**Precision depends on how common the species is where the node stands.** The chance that a detection is right depends on two things: how well the detector tells the species apart from everything else, and how often the species really calls at that place compared with all the other sounds the detector might take for it. A curve fitted where a species is common overstates precision where it is rare, and where the species is absent every detection is false (Navine et al. 2024). In TABMON's Norwegian labels the skylark was right 30 times out of 30; in Scanferla's alpine data no skylark detection was right at all. The answer is hierarchical calibration: one curve shape per species, with an offset per place and month that is learned from the place's own clips where it has them and borrowed from comparable places where it has none. In a 2026 test, the 90% interval from one network-wide curve covered the true value in only 15 to 52% of cases where sites differed, against 92 to 95% for the hierarchical one, whose intervals were also about two thirds narrower than fitting each site alone, and which worked for sites with no checked clips at all (Freeland-Haynes et al. 2026, a preprint). The month matters too: it improved the model for 32 of 37 species in an Italian study, and monthly thresholds of the same species differed by 0.46 on average (Chiatante and Canestrelli 2026).

**Some species have no threshold, and some names need merging.** In TABMON's labels the spotted crake was wrong 91 times out of 91, up to a score of 0.96, usually with no bird in the clip at all; Baillon's crake 38 out of 38. In Norway every "carrion crow" was a hooded crow, the right bird under the wrong name. In German farmland, rook and tree sparrow had to be merged with their nearest relatives because they cannot be told apart by sound (Kasten et al. 2026). So the calibration register has to be able to say "never counted here" and "counted as a group", not only "threshold 0.4".

**Many thresholds are lower than 0.7, not higher.** In TABMON's labels, which start at a score of 0.2, the blackbird was right 65 times out of 65, and house sparrow, blue tit and yellowhammer had their 0.95 point between 0.29 and 0.36. Redwing and chiffchaff, right 92 and 95% of the time, showed no clear rise with the score at all. Sovon's blackbird, missed at all 34 points at 0.5 and up, is a problem of what the detector misses, not of what it gets wrong. A node that sends only 0.7 and up cannot use those lower thresholds. *Specified:* the node sends detections from 0.1 up, or counts per species, hour and band, once the data volume against the ten-year SIM has been measured on node 1.

### A first run on open labels

TABMON published 3,000 clips checked by experts, 1,000 each from France, Norway and Spain, with BirdNET's score for each (Zenodo, CC BY 4.0). We fitted Wood and Kahl's curve to every species with at least 25 labels (unsure labels left out; a genus-only answer counted as unsure). The script is [`scripts/calibration/wood-kahl.py`](https://github.com/oncra/life/blob/main/scripts/calibration/wood-kahl.py).

| Species | Country | Clips | Right | Score for 0.95 | 95% interval |
| --- | --- | --- | --- | --- | --- |
| Blackbird | Norway | 65 | 100% | any score from 0.2 | |
| Skylark | Norway | 30 | 100% | any score from 0.2 | |
| Chiffchaff | Norway | 111 | 95% | flat curve | |
| Yellowhammer | Norway | 32 | 97% | 0.36 | 0 to 0.93 |
| Blue tit | Norway | 35 | 94% | 0.36 | 0 to 0.45 |
| House sparrow | Spain | 46 | 98% | 0.29 | 0 to 0.43 |
| Common tern | Spain | 42 | 95% | 0.57 | 0 to 0.87 |
| Redwing | Norway | 48 | 92% | not reached | |
| Spotted crake | Spain, Norway | 91 | 0% | never | |
| Baillon's crake | Spain | 38 | 0% | never | |
| Carrion crow | Norway | 60 | 0% (all hooded crows) | never | |

Three things stand out. The intervals are wide: 30 to 60 clips per species, mostly right, cannot pin a curve, which is the sample-size point above in real data. A species is not good or bad everywhere: where the same species had enough labels in two countries, a single curve fitted worse than one per country for black-winged stilt and mallard (likelihood-ratio test, p = 0.02 and 0.03). And the wrong detections are not random: noise that the detector takes for a crake, again and again, at high scores. TABMON's annotators saw BirdNET's score while they checked; one annotator per country.

### How the clips are checked

*Specified*, from what the studies above do and do not report: the checker labels the three seconds the detector scored, inside the fifteen-second clip; the checker does not see the score; a label is right, wrong or unsure, with the species that sang when it is wrong; unsure counts as wrong wherever money depends on it; a second checker labels 10 to 20% of the clips and the agreement between the two is published (Cohen's kappa). Most published calibrations rest on one expert and report no agreement at all; on the hardest clips, experts disagreed 16.6% of the time (Stowell et al. 2019). Checked clips are kept for good: they are the only way to refit the curves when the detector changes. For a claim that carries money, the checker is independent of the place's steward and of the project, as Plan Vivo requires (section 7).

## 3. Presence: was the species here this season?

**Verified presence**: a checker confirmed at least one clip of the species from this node this season. This is the strongest claim the node can make, and its error is the checker's. It is also how Plan Vivo counts a species: only after human quality control.

**Probable presence**: a probability, from the detections and the calibration, through an occupancy model that allows for false detections and is fitted across many nodes. What does not work is setting a threshold and then running an ordinary occupancy model: on Saxon farmland (49 AudioMoths, BirdNET; skylark, whitethroat, yellowhammer, tree sparrow and yellow wagtail), the intervals of that approach contained the true value in 1 to 5% of simulated cases, against 84 to 94% for a model that reads the scores themselves (45% in its hardest scenario) (Ogawa et al. 2025).

**Not heard** is not "absent", but it can be given a probability. From March to October a node listens four hours every morning; in one study about 250 minutes of recording found 80% of the sites where people had found a species, and ten minutes found 27% (Cole et al. 2022). A bird that sings regularly inside the node's hearing will rarely be missed over a season. A bird that is seen rather than heard can be missed all season: on Polish farmland 23% of the observers' identifications were visual only (Kułaga and Budka 2019), and swallows, birds of prey and waders are among them.

**A species list is built species by species.** Errors pile up when every species with any detection is listed: at a score of 0.1, single detections in a European dataset were right 61% of the time, but the species lists built from them only 28% (Funosas et al. 2026). The node's list is the species whose presence passes one of the two tests above.

## 4. Activity: how much a species is heard

**What to count.** *Specified:* per species and season, the share of listening minutes in which the species is heard, from calibrated detections, with an interval from a bootstrap over blocks of days. Not the number of days a species is heard. With a fair chance of hearing one territory on a given day, three territories already make it nearly certain that the species is heard every day, so days heard says how long a species is around, not how many there are. It stays in use for presence and timing. The share of three-second windows with the species keeps rising roughly in proportion with the number of singing birds for longer: up to about eight birds in a simple calculation. Better still, average the calibrated probabilities of all windows instead of counting the windows above a threshold, so that nothing is thrown away at the threshold (Freeland-Haynes et al. 2026).

**Does activity follow numbers?** Sometimes, and only where it has been checked. Songs per minute against counted birds: R² 0.68 for bee-eaters, and 0.84 for Dupont's lark on a logarithmic curve that flattens as birds are added (Pérez-Granados et al. 2019). Counting calls and dividing by a calling rate measured at the site: slope 1.03, R² 0.84; with a calling rate taken from recordings elsewhere, 41% too low (Pérez-Granados et al. 2021). For green toads a call index followed the calls counted by hand but not the number of males (Kaczmarski et al. 2025). No such calibration exists yet for the Dutch farmland species.

**Comparable only within its own setup.** Two recorder models side by side made 169 and 447 robin detections (Jarrett et al. 2025). A change of microphone, mounting, detector version, threshold or listening windows is a new series. That is why the listening windows are fixed, why every detection carries its detector and version, and why a change of model runs beside the old one for a year before it replaces it, as Plan Vivo requires for any change of technology.

## 5. Numbers of birds

**One node cannot count birds by itself.** A single recorder gave 6.0 birds per hectare with a coefficient of variation of 27%, 29% below what people counted; it heard birds out to 23 m where people managed 48 m (Sebastián-González et al. 2018). One sensor has no replication from which to estimate the uncertainty of a density (Marques et al. 2013).

**Calibrate the stratum with counts beside the nodes.** The four MAS counts a spring at each node ([bird protocols](bird-protocols.md), section 2) can anchor a joint model of detections and counts. In simulations such a model narrowed the 95% interval of mean abundance (on the log scale) from 0.63 with counts alone to 0.42, and it needs tens of sites: with four recorder sites the trend stayed vague (Doser et al. 2021). Two things make the counts usable for this. The node must be listening during the count. And the counter notes each bird's distance band, because a recorder and a person do not hear the same circle: across 35 species the recorder's effective radius was 0.95 of a person's (0.78 to 1.11), and putting that ratio into the density calculation removed the bias, with r = 0.84 at sites held out (Van Wilgenburg et al. 2017). Habitat changes the area heard by a factor of 2.7 to 6.4 between open and closed vegetation (Yip et al. 2025), and background noise by a factor of up to 25 (Haupert et al. 2023). The result is birds or territories per hectare per stratum with an interval, and for one node a prediction with a prediction interval, never the narrower interval of a mean ([specification](spec.md), 5b, rule 4).

**Or put several nodes in one field.** Twenty-nine synchronised sensors on 12 hectares counted territories as well as experts did (Brüggemann et al. 2025), and AudioMoths on farmland placed 92% of sounds within 2 m (Buchmann and Schurr 2025). That is a research array, not the standard node.

**Trends are what the farmland bird index measures.** The Nature Restoration Regulation defines the index as "the rate of change in the relative abundance" (Annex V), so the change in a calibrated activity index is the right kind of quantity, as long as the setup stays the same. How many nodes that takes depends on how much a node's index varies from year to year, which no one has measured yet. If a node's index varies by 0.3 on the log scale from year to year (an assumption until it is measured), detecting a decline of 5% a year within ten years takes four to six nodes together, and 2% a year twenty to forty; one node alone would need twelve to twenty years. A single field's trend will rarely clear its own noise; a group of fields can. The species indices combine into a multi-species index the way the national one is built: a geometric mean, with its interval from a Monte Carlo draw of every species' index within its own standard error (Soldaat et al. 2017, Statistics Netherlands' MSI-tool). We found no such index built from recorders yet.

## 6. Bats

**What a bat detection measures** is activity near one microphone. An AudioMoth picked up test tones out to 32 m (Quarles et al. 2026); bats are heard up to 52% further in open land than in forest, and calls from behind the microphone arrive 15 dB weaker (Entling et al. 2026). One bat circling the node makes many passes.

**There is no route from bat sound to bat numbers.** The density model for sensor data swung tenfold in the field with the call loudness and beam width assumed (Milchram et al. 2020), estimated densities did not follow roost counts (Hoggatt et al. 2024), and the official estimate for noctules in England runs from 17,700 to 1,872,000 adults, its 95% interval (JNCC 2019).

**Identification errors are large outside a few species.** Checking 212,347 passes labelled by a classifier in France, the share that was wrong was 85% for noctule, 62% for Nathusius' pipistrelle, 50% for Leisler's bat, 15% for Myotis, 13% for long-eared bats, 4% for serotine, 0.7% for common pipistrelle and 0.3% for barbastelle; uncorrected, the noctule seemed present at 22% of sites where the true figure was 8% (Barré et al. 2019). On Dutch and Belgian species four programs named 31 to 77% of calls to species and 85 to 88% to the right group (Brabant et al. 2018). The node's bat model, BattyBirdNET, has no published validation, and its author writes that he would not use it for fully automated monitoring.

**What a node can claim:** bats were active on a given night; a species group was present this season, once a checker has confirmed a clip; the common pipistrelle to species; and activity per group as active minutes per night, compared only with the same node in other years (pipistrelle activity along a hedgerow was 17 times that in an open field, Barré et al. 2019). Not numbers, not richness, not absence, not Myotis, long-eared or noctule-type bats to species. The calibration follows Barré: two experts check 25 passes per score band per species, thresholds are set at two error tolerances, the labels include "right genus, wrong species" and "cannot tell", and a species that never gets below about 20% error is reported only as its group.

**The evening hour is a dusk index.** The node's evening window is the hour after sunset. In France's national bat scheme (9,807 nights), pipistrelles and noctules peak early, but Myotis, long-eared bats and barbastelles first appear about 16% into the night, some 86 minutes after sunset on a nine-hour night (Mariton et al. 2023); only whole nights found 90% of the species (Froidevaux et al. 2014), and the British farm protocol records at least four whole nights at a time. Whole nights do not fit the node's power budget today (the bat model draws about 2.5 W extra). *Open:* whole nights on a few nights a month when the battery is full, or a stand-alone recorder at visits.

## 7. What the money side asks for

**No scheme sets one confidence level for species outcomes, and none has yet paid on acoustic evidence** as far as we could find. The strictest written rule is Plan Vivo's PV Nature methodology (2026): in years two to five a change counts only if it lies outside the 95% confidence interval, from year five only if a five-year trend is significant; methods must allow "species detection probability and classification error" to be estimated; only species confirmed by human quality control count, and the experts who do it must be independent of the project; a change of technology needs a year of monitoring with both. It accepts sound recorders and machine labels. It also wants sampling points re-drawn at random every year, which a fixed node per field does not do; that has to be resolved with the standard. Its first certificates are expected in 2028. Verra's Nature Framework asks for a power analysis, sets reference values at the top of the 90% interval, holds 20% in a buffer and lists acoustic sampling for birds and bats.

**The EU carbon farming rules** (C(2026)4666, Annex, section 5.3) accept a biodiversity co-benefit "by result" only if it is "consistent with applicable indicators and methodologies under national and Union legislation", such as an improvement in the farmland bird index, and set no statistic for it. For carbon itself the same act deducts at least 8% for uncertainty, works with one-sided confidence levels of 70% (soil) and 90% (biomass), and wants models validated on data from other locations. **The CAP schemes that pay on birds** pay on presence or on nests (€50 a nest in Bremen), and none of the 39 schemes reviewed uses sound (Hagemann et al. 2025). The figure of about 5% false positives and 10 to 20% false negatives often quoted for EU payment checks comes from the satellite monitoring of whether parcels meet eligibility conditions, measured against field visits (Devos et al. 2018), not from biodiversity. **Bats** are the one place where Dutch practice already uses automatic detectors: in the national monitoring network's car transects and in municipal species management plans, always with experts checking the sound.

**Money moves on the lower bound.** Carbon is issued on a one-sided lower bound between 66.7% (Verra's VM0042) and 90% (EU biomass), biodiversity under Plan Vivo only beyond the 95% interval. The Life Oracle's rule already says that a range spanning zero pays nothing ([specification](spec.md), 5b, rule 1). *Specified* for biodiversity: a plus counts only where the one-sided 95% lower bound of the change from the place's own baseline is above zero, with unsure labels counted as wrong.

## 8. The ladder

| Claim | Statistic | Needs | Status |
| --- | --- | --- | --- |
| A detection | score | the node | built |
| Species present, verified | at least one clip confirmed by a checker | clip collection and a checker | node software written, not in a released image |
| Species present, probable | probability from an occupancy model with false detections | calibration register, many nodes | specified |
| Species not heard | probability it was there and missed | the same model | specified |
| Activity of a species | share of listening minutes, with interval | calibration, a fixed setup | specified |
| Trend of a species | change between seasons, with interval | two seasons or more, a fixed setup, groups of nodes | specified |
| Farmland bird lane | geometric mean of species trends, Monte Carlo interval | the above, on the Annex V species | specified (activity instead of days heard) |
| Birds per hectare | joint model of detections and counts | MAS counts with distance bands at tens of nodes | open |
| Bats | group presence, active minutes per night | a checked register after Barré | specified |

## 9. What changes

**Built** with this page: the clip sample records how many detections each kept clip stands for (`bands.csv`), and the calibration on TABMON's labels can be rerun from the repository.

**Specified:**

1. A calibration register per species and stratum (habitat, month, microphone, detector version), fitted hierarchically, publishing per species the number of checked clips, the curve, the threshold with its interval, the set precision and "never" or "as a group" where that is the answer. Thresholds at the upper end of their interval; until a species has enough clips, the binomial floor.
2. Detections sent from 0.1 up, or counts per species, hour and band, once the data volume on node 1 is measured against the ten-year SIM.
3. Checking blind to the score, on the three seconds that were scored, unsure counted as wrong, a second checker on 10 to 20%, agreement published, checked clips kept for good, checkers independent where money is involved.
4. At each MAS count the node listens and the counter notes distance bands; playback at visits measures how far the node hears.
5. The farmland bird lane counts the share of listening minutes a species is heard, not days heard.
6. Detector, version and settings on every detection; a new model runs a year beside the old one.
7. The bat lane is a dusk index of activity per group; whole nights stay open (section 6).

**Open:** randomly drawn sound windows that no detection triggered, so that checkers can count what the detector missed ([specification](spec.md), 11); a node's year-to-year spread, which sets how many nodes a trend needs; and how a fixed node fits a standard that re-draws its sampling points every year.

## Sources

Checked on 27 October 2026. Where we could read only the abstract, the number quoted is from the abstract.

- Wood, C. M. and Kahl, S. (2024). Guidelines for appropriate use of BirdNET scores and other detector outputs. *Journal of Ornithology* 165: 777-782. [doi:10.1007/s10336-024-02144-5](https://doi.org/10.1007/s10336-024-02144-5). Tutorial and sample data in the supplementary material.
- Tseng, S. et al. (2025). Setting BirdNET confidence thresholds: species-specific vs. universal approaches. *Journal of Ornithology* 166: 1123-1135. [doi:10.1007/s10336-025-02260-w](https://doi.org/10.1007/s10336-025-02260-w).
- Scanferla, J. et al. (2025). Determining species-specific thresholds to improve precision in passive acoustic monitoring. *Ecological Informatics* 91: 103423. [doi:10.1016/j.ecoinf.2025.103423](https://doi.org/10.1016/j.ecoinf.2025.103423).
- Freeland-Haynes, L. et al. (2026). Calibrating classifiers across covariates: hierarchical vocal density estimation for acoustic monitoring at scale. *bioRxiv*. [doi:10.64898/2026.09.08.747031](https://doi.org/10.64898/2026.09.08.747031).
- Navine, A. K. et al. (2024). All thresholds barred. *Frontiers in Bird Science* 3: 1380636. [doi:10.3389/fbirs.2024.1380636](https://doi.org/10.3389/fbirs.2024.1380636).
- Chiatante, G. and Canestrelli, D. (2026). Temporal dynamics of animal vocal behavior affect semi-automatic identifications. *Ecological Processes* 15: 4. [doi:10.1186/s13717-025-00664-3](https://doi.org/10.1186/s13717-025-00664-3).
- Kasten et al. (2026). Farmland bird diversity requires heterogeneity between and within habitats. *Landscape Ecology* 41: 117. [doi:10.1007/s10980-026-02406-y](https://doi.org/10.1007/s10980-026-02406-y).
- Funosas, D. et al. (2026). A global assessment of BirdNET performance. *Ecological Indicators*. [doi:10.1016/j.ecolind.2025.114550](https://doi.org/10.1016/j.ecolind.2025.114550).
- Cretois, B. et al. (2026). TABMON. *Methods in Ecology and Evolution* 17: 1867-1879. [doi:10.1111/2041-210x.70308](https://doi.org/10.1111/2041-210x.70308). Data and expert labels: [Zenodo 21103360](https://zenodo.org/records/21103360), CC BY 4.0; labels by Tom Østerås (Norway), Tanguy Loïs, BioPhonia (France), and Lluís Brotons, CTFC and ICO (Spain).
- Stowell, D. et al. (2019). Automatic acoustic detection of birds through deep learning. *Methods in Ecology and Evolution* 10: 368-380. [arXiv:1807.05812](https://arxiv.org/abs/1807.05812).
- Ogawa, R. et al. (2025). A classification-occupancy model based on automatically identified species data. *Ecology* 106: e70086. [doi:10.1002/ecy.70086](https://doi.org/10.1002/ecy.70086).
- Cole, J. S. et al. (2022). *Ornithological Applications* 124: duac003. [doi:10.1093/ornithapp/duac003](https://doi.org/10.1093/ornithapp/duac003).
- Kułaga, K. and Budka, M. (2019). *PLoS ONE* 14: e0211970. [doi:10.1371/journal.pone.0211970](https://doi.org/10.1371/journal.pone.0211970).
- Pérez-Granados, C. et al. (2019). Vocal activity rate index. *Ibis* 161: 901-907. [doi:10.1111/ibi.12728](https://doi.org/10.1111/ibi.12728).
- Pérez-Granados, C. et al. (2021). *Avian Conservation and Ecology* 16: 11. [doi:10.5751/ACE-01801-160111](https://doi.org/10.5751/ACE-01801-160111).
- Kaczmarski, M. et al. (2025). *Scientific Reports*. [doi:10.1038/s41598-025-11706-3](https://doi.org/10.1038/s41598-025-11706-3).
- Jarrett, C. et al. (2025). Mitigating bias in long-term terrestrial ecoacoustic studies. *Journal of Applied Ecology*. [doi:10.1111/1365-2664.70000](https://doi.org/10.1111/1365-2664.70000).
- Sebastián-González, E. et al. (2018). *Avian Conservation and Ecology* 13: 7. [doi:10.5751/ACE-01224-130207](https://doi.org/10.5751/ACE-01224-130207).
- Marques, T. A. et al. (2013). Estimating animal population density using passive acoustics. *Biological Reviews* 88: 287-309. [doi:10.1111/brv.12001](https://doi.org/10.1111/brv.12001).
- Doser, J. W. et al. (2021). Integrating automated acoustic vocalization data and point count surveys for estimation of bird abundance. *Methods in Ecology and Evolution* 12: 1040-1049. [doi:10.1111/2041-210X.13578](https://doi.org/10.1111/2041-210X.13578).
- Van Wilgenburg, S. L. et al. (2017). Paired sampling standardizes point count data from humans and acoustic recorders. *Avian Conservation and Ecology* 12: 13. [doi:10.5751/ACE-00975-120113](https://doi.org/10.5751/ACE-00975-120113).
- Yip, D. A. et al. (2025). *Ornithological Applications*. [doi:10.1093/ornithapp/duaf059](https://doi.org/10.1093/ornithapp/duaf059).
- Haupert, S., Sèbe, F. and Sueur, J. (2023). *Methods in Ecology and Evolution* 14: 614-630. [doi:10.1111/2041-210X.14020](https://doi.org/10.1111/2041-210X.14020).
- Brüggemann, L. et al. (2025). Territorial acoustic species estimation using acoustic sensor networks. *Ecological Informatics*. [doi:10.1016/j.ecoinf.2025.103281](https://doi.org/10.1016/j.ecoinf.2025.103281).
- Buchmann, C. and Schurr, F. (2025). *Ibis*. [doi:10.1111/ibi.70012](https://doi.org/10.1111/ibi.70012).
- Soldaat, L. et al. (2017). A Monte Carlo method to account for sampling error in multi-species indicators. *Ecological Indicators* 81: 340-347. [doi:10.1016/j.ecolind.2017.05.033](https://doi.org/10.1016/j.ecolind.2017.05.033).
- Regulation (EU) 2024/1991 on nature restoration, Annex V: [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1991/oj).
- Quarles, L. et al. (2026). *Oryx*. [doi:10.1017/s0030605326102956](https://doi.org/10.1017/s0030605326102956). Entling, M. H. et al. (2026). [doi:10.1111/aab.70042](https://doi.org/10.1111/aab.70042).
- Milchram, M. et al. (2020). *Ecology and Evolution*. [doi:10.1002/ece3.5928](https://doi.org/10.1002/ece3.5928). Hoggatt, M. L. et al. (2024). *Ecology and Evolution*. [doi:10.1002/ece3.11051](https://doi.org/10.1002/ece3.11051).
- Barré, K. et al. (2019). Accounting for automated identification errors in acoustic surveys. *Methods in Ecology and Evolution* 10: 1171-1188. [doi:10.1111/2041-210X.13198](https://doi.org/10.1111/2041-210X.13198).
- Brabant, R. et al. (2018). *Belgian Journal of Zoology*. [doi:10.26496/bjz.2018.21](https://doi.org/10.26496/bjz.2018.21).
- Mariton, L. et al. (2023). *Biological Conservation*: 109852. [doi:10.1016/j.biocon.2022.109852](https://doi.org/10.1016/j.biocon.2022.109852). Froidevaux, J. S. P. et al. (2014). *Ecology and Evolution*. [doi:10.1002/ece3.1296](https://doi.org/10.1002/ece3.1296). Newson, S. E. and Gray, A. (2024). BTO Research Report 768.
- JNCC (2019). Fourth UK report under Article 17 of the Habitats Directive, form S1312-EN (noctule, England).
- BattyBirdNET-Analyzer: [github.com/rdz-oss/BattyBirdNET-Analyzer](https://github.com/rdz-oss/BattyBirdNET-Analyzer).
- Plan Vivo, PV Nature Methodology and Data Protocol (file V1.2, April 2026): [planvivo.org](https://www.planvivo.org/projects/certify-a-project/pvnature/pv-nature-documents).
- Verra, Nature Framework, SDVM002 v1.0: [verra.org](https://verra.org/).
- Commission Delegated Regulation C(2026)4666, Annex, as sent to the Council: [ST 11809/26 ADD 1](https://data.consilium.europa.eu/doc/document/ST-11809-2026-ADD-1/en/pdf).
- Hagemann, N. et al. (2025). *Regional Environmental Change* 25. [doi:10.1007/s10113-024-02324-2](https://doi.org/10.1007/s10113-024-02324-2).
- Devos, W. et al. (2018). Technical guidance on the decision to go for substitution of OTSC by monitoring. JRC112918. [doi:10.2760/693101](https://doi.org/10.2760/693101).
- Cord, A. F. et al. (2025). Leveraging passive acoustic monitoring for result-based agri-environmental schemes. *Biological Conservation*. [doi:10.1016/j.biocon.2025.111042](https://doi.org/10.1016/j.biocon.2025.111042).
