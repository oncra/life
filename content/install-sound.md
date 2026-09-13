---
title: "Installation protocol: sound recorder"
summary: "Height, orientation, spacing, schedule and maintenance for each kit, so that recordings from different places are comparable."
order: 7
---

# Installation protocol: sound recorder

The point of a protocol is comparability. Two recorders installed the same way in two places hear the same fraction of what is there. Deviations are fine; write them in the device notes.

## Placement

- **Height 1.5 to 2 m** on a post, fence pole or small tree (Kit A and B). Bats (Kit C): 3 to 4 m, microphone pointing into the open, 1.5 m clear of foliage.
- **Microphone horizontal, facing the open habitat**, never into a trunk or wall. Detection ranges are up to 52% larger in open land than in forest and fall by up to 15 dB at 40 kHz when the microphone faces the wrong way.
- **Not within 30 m of a road, pump or building** unless that noise is what you want to measure (it is counted as Autonomy signal either way, but it masks birds).
- **Spacing 250 to 300 m** between recorders in open land (one per 6 to 9 ha). One recorder at the edge covers a 3 to 5 ha meadow. For bats, 150 to 200 m along hedgerows, tree lines and water.
- Record the position with your phone's GPS and put it in the device registration (`lat`, `lon`, `heightM`).

## Schedule (Kit A, offline)

- Birds: 1 h before sunrise to 3 h after, plus 1 h around sunset, at 48 kHz.
- Summer addition for crickets and frogs: 22:00 to 02:00.
- Bats: sunset −30 min to sunrise +30 min, trigger-based, 256 to 384 kHz.
- The AudioMoth configuration app computes battery life for the schedule. A dawn/dusk schedule runs 6 to 8 weeks on three lithium AA cells.

Kit B (connected) runs continuously.

## Weatherproofing

- Kit A: the IPX7 case with a Porelle membrane vent; a silica sachet inside; lid seal checked at every swap.
- Kit B: PUC in the shade of its panel, panel facing south at 30 to 45 degrees, router in a barn with an external antenna if the field is more than 30 m away.
- Cable lock through the case loop. Recorders do get stolen; a €10 lock halves it.

## Maintenance

| Kit | Interval | Do |
| --- | --- | --- |
| A (AudioMoth, Micro 2) | 6 to 8 weeks | swap microSD and batteries; check seal; photograph the mounting |
| B (PUC, BirdNET-Pi) | monthly | check uptime on the dashboard; wipe microphone port; check panel |
| C (Mini Bat 2) | 6 weeks (AA) / 3 to 4 months (Li-ion) | swap card and batteries |

## What to write in the device notes

Mount type, direction the microphone faces (compass), habitat within 50 m (hedge, ditch, crop), nearest noise source and distance, schedule used. These are read by verifiers and by anyone comparing places.
