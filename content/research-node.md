---
title: "The research node: whole listening windows over 4G"
summary: "A standard Life node with one switch more: it keeps every second of its listening windows as audio, mutes voices, and sends the files over 4G, so a study gets all the sound without visits. A codec test, and the data, storage, energy and cost per window length."
order: 3.5
---

# The research node

**Decided 25 November 2026, not built yet.** A study that compares the node with other recorders and with counts in the field needs more than the node's detections and a sample of its clips: it needs all the sound, from every device, for the same minutes. The research node gives it that without anyone having to fetch a card.

## What it is

A research node is a standard Life node with research settings on. It is the same box, the same software and the same image. The switch is per node, off by default, and set on the oracle like the node's other settings ([spec](spec.md), 2.2), so every fix and every new version reaches a research node the way it reaches the others, and nothing is forked.

Its readings stay comparable with every other node. The readings count the method's listening windows, however long a research node listens; hours a study adds on top are recorded, kept and shown, and never counted, as with any hours outside the windows ([spec](spec.md), 2.2).

## What it adds

1. **Whole listening windows as audio files.** AAC at 96 kbps, mono, 32 kHz (the format tested below), one file per window per day, sent in pieces of ten minutes.
2. **Sent over 4G.** A data SIM in place of the ten-year IoT SIM. The node sends each piece while it records the next, so it does not stay awake longer to send. A monthly cap is set per node, so a fault cannot run up a bill. The card holds every piece until the oracle has it, checked by its SHA-256, so a week without signal loses nothing.
3. **Voices muted on the node.** A speech detector silences voices before a file leaves the box, and the muted seconds are listed with each window, as time not listened. Whoever works on the land is told the node records.
4. **Every detection from 0.1 sent**, not only those of 0.7 and up.
5. **Clips cut on the oracle from the windows**, for any detection on any device and the same seconds from the others. The node no longer keeps clips of its own for the birds.
6. **Bats keep their own clips** at the full rate: a 32 kHz file holds no ultrasound.

## Why whole windows rather than clips

- **Comparing devices.** With windows, the same seconds can be heard from every device for a bird that any of them detected. With clips, a bird that one device missed has no clip from that device, and those are the cases a comparison is about.
- **Microphone or model.** One version of a model can be run again over every device's sound, which separates what the microphone heard from how the model scored it.
- **Clocks.** Files can be lined up on the sound itself when a recorder's clock drifts.
- **Proof of effort.** Each window says how many minutes were heard. With clips, a quiet morning and a lost upload look the same.
- **Fewer files.** About 610 a node a year, against more than a million clips from score 0.1 at a busy site.

## The codec: a test (25 November 2026)

The one published measurement found is MacPhail et al. (2024): MP3 at 96 kbps, on stereo recordings and so about 48 kbps per channel, lowered recall for two single-species recognisers and the number of birds listeners found; at 320 kbps nothing measurable changed. The authors recommend lossless. No published test of AAC or Opus with BirdNET or Perch was found.

So we ran one. Four lossless hours from Cornell's public Sapsucker Woods soundscapes (Kahl et al., Zenodo 7079380; FLAC, 32 kHz, mono): three May mornings and one February morning, with 3,260 calls marked by experts, 3,235 of them of species BirdNET knows. Each hour was encoded with ffmpeg as the node would, and BirdNET v2.4 (the model BirdNET-Go ships) ran on every version in 3-second chunks, without a location filter. Recall is the share of marked calls found (the species in a chunk that overlaps the call), precision the share of detections that fall on a marked call of their species.

| Format | MB per hour | Recall at 0.5 | Precision at 0.5 | Recall at 0.1 | Lossless detections kept (0.5) | Mean score change |
|---|---|---|---|---|---|---|
| FLAC, lossless | 97 | 25.6% | 80.5% | 68.4% | 100% | 0 |
| AAC 128 kbps | 51 | 26.0% | 80.7% | 69.0% | 96% | 0.021 |
| **AAC 96 kbps** | **47** | **26.4%** | **81.2%** | **68.4%** | **94%** | **0.025** |
| AAC 64 kbps | 30 | 24.0% | 81.9% | 66.9% | 81% | 0.054 |
| MP3 96 kbps | 43 | 26.4% | 76.1% | 67.0% | 95% | 0.039 |
| Opus 64 kbps | 27 | 24.6% | 81.3% | 67.4% | 87% | 0.044 |
| Opus 32 kbps | 13 | 17.4% | 75.4% | 54.0% | 60% | 0.118 |

- **AAC at 96 kbps and up is as good as lossless here**, at half its size. Recall and precision stay within a point, and about one detection in sixteen moves across the 0.5 line, in both directions.
- **The bitrate matters more than the codec.** At 64 kbps AAC and Opus lose 1 to 1.6 points of recall at 0.5, four to six per cent of the right detections; at 32 kbps Opus loses a third.
- **MP3 at 96 kbps mono keeps recall but adds false alarms.**
- **Lossless is not uncompressed.** FLAC already halves raw audio (230 MB an hour to 97), and silence costs it almost nothing; what it has to keep, sample for sample, is the background noise of a field. A lossy codec drops what cannot be heard.
- **Limits:** one model, one site in New York State, four hours, another recorder than the node's. The first weeks of the first research node keep the lossless file beside the AAC one, to repeat the check on the node's own microphone and with Perch.
- **A finding for every node:** the clips a standard node keeps are cut today from BirdNET-Go's Opus export at 32 kbps, the format that lost a third of the right detections in this test. The node's detections are made on the live sound and do not change; what an expert hears does. Specified: a better clip export, at a higher bitrate or lossless, weighed against what it writes to the card, since BirdNET-Go writes a clip for every detection from 0.1 before the node keeps a few.
- FFmpeg's Opus encoder takes a 32 kHz input down to 24 kHz and so cuts everything above 12 kHz, which BirdNET does not survive; feed it 48 kHz. The scripts are in `scripts/codec-test/`.

## Data, storage and cost per window length

At 47 MB an hour (AAC, 96 kbps), per node:

| Windows | Hours a year | Data a year | Busiest month | Data plan | Storage, five nodes, a year |
|---|---|---|---|---|---|
| The method's (5 h March to October, 2 h November to February) | 1,465 | 69 GB | 7.3 GB | 10 GB, about €9.50 a month | 0.34 TB |
| 8 hours a day | 2,920 | 137 GB | 11.7 GB | 20 GB, about €11 a month | 0.69 TB |
| 12 hours a day | 4,380 | 206 GB | 17.5 GB | 20 to 30 GB, about €11 to €13 | 1.0 TB |
| Around the clock | 8,760 | 412 GB | 35 GB | 40 GB or more (not checked) | 2.1 TB |

The plans are Dutch SIM-only plans from comparison sites in November 2026, including VAT; each runs on one network, so coverage is checked at each site, and the terms must allow a SIM in a modem. Pay per use on an IoT SIM (1NCE High Data, €2.60 per GB and €0.50 a month, excluding VAT) costs about €184 a year for the method's windows and €362 for 8 hours. The archive is a Hetzner Storage Box: 1 TB for €3.20 a month up to 8-hour windows, 5 TB for €10.90 beyond, both excluding VAT, with a second copy elsewhere.

## Energy: what longer windows really cost

Data is cheap; light in winter is not. The node's winter simulation (`kit/winter-energy.py`: KNMI's hourly measurements at Schiphol for the winters of 2016 to 2025, a free panel at 40 degrees, 3.7 Wh from the battery per hour awake, from the 3.1 W measured on node 1, and the floor of 4.6 Wh a day) gives the share of window hours lost from November to February, with the panel at its full harvest and, in brackets, at half:

| Winter windows | 40 W panel, 10 Ah (the standard) | 100 W panel, 20 Ah |
|---|---|---|
| 2 hours (the method's) | 0% (1.7%) | 0% (0%) |
| 4 hours | 1.1% (16%) | 0% (0%) |
| 8 hours | 14.5% (44%) | 0.1% (3.8%) |

(`python3 kit/winter-energy.py --hours 8 --wp 100` gives the 8-hour row on the larger panel.) So a research node with long winter windows takes the 100 W panel and the 20 Ah battery, both already options on the order list ([kit](kit.md)), about €66 more in parts. The same panel carries an 8-hour summer day under a crop: about 80 Wh harvested against 34 Wh used. Sending over 4G is not yet in these figures; it is measured on node 1's bench before the first research node goes out.

## What waits

- **The windows**, set with the study. Their length is a setting: it decides the data plan and the panel, not the software.
- **The build:** the recorder, the voice mute, the upload with its cap, and on the oracle the receiving, a check that every window is complete, the archive, and clips cut from the windows. First on node 1, at the bench.
- **The method text:** the specification says raw audio never leaves a node. For a research node it does, with voices muted, on its owner's switch.

## Sources

- MacPhail, A. G., Yip, D. A., Knight, E. C., Hedley, R., Knaggs, M., Shonfield, J., and Bayne, E. M. (2024). [Audio data compression affects acoustic indices and reduces detections of birds by human listening and automated recognisers](https://doi.org/10.1080/09524622.2023.2290718). Bioacoustics 33(1), 74-90.
- Kahl, S., Charif, R., and Klinck, H. (2022). [A collection of fully-annotated soundscape recordings from the Northeastern United States](https://zenodo.org/records/7079380). Zenodo, CC BY 4.0.
- [1NCE High Data IoT](https://www.1nce.com/en-eu/1nce-connect/features/high-data-iot); [Hetzner Storage Box](https://www.hetzner.com/storage/storage-box); SIM-only prices from [Overstapmaatje](https://overstapmaatje.nl/sim-only/maandelijks-opzegbaar/).
