---
title: "Installation protocol: sound recorder"
summary: "Height, orientation, spacing, schedule and maintenance for the node and for the alternative sets, so that recordings from different places are comparable."
order: 9
---

# Installation protocol: sound recorder

The point of a protocol is comparability. Two recorders installed the same way in two places hear the same fraction of what is there. Deviations are fine; write them in the device notes.

This applies to the standard [Life node](/docs/kit), where the microphone sits in the same enclosure as the computer and the modem, and to the alternative sets in the [hardware guide](/docs/hardware). One rule that matters more than any of the numbers below: **keep one microphone type across every node in a network.** Diversity and Renewal compare species counts between years and between places, so a change of microphone is a systematic shift in exactly the thing being compared.

## Placement

- **Height 1.5 to 2 m** on a post, fence pole or small tree (node, PUC, AudioMoth). Ultrasonic recorders for bats: 3 to 4 m, microphone pointing into the open, 1.5 m clear of foliage.
- **Microphone horizontal, facing the open habitat**, never into a trunk or wall. Detection ranges are up to 52% larger in open land than in forest and fall by up to 15 dB at 40 kHz when the microphone faces the wrong way.
- **Not within 30 m of a road, pump or building** unless that noise is what you want to measure (it is counted as Autonomy signal either way, but it masks birds).
- **Spacing 250 to 300 m** between recorders in open land (one per 6 to 9 ha). One recorder at the edge covers a 3 to 5 ha meadow. For bats, 150 to 200 m along hedgerows, tree lines and water.
- **On a node**, the microphone points away from the enclosure through a downward-facing gland with a hydrophobic membrane, and the solar panel goes above it, not in front of it. The post carries the box at 1.5 to 2 m and the probe cable leaves at the bottom.
- Record the position with your phone's GPS and put it in the device registration (`lat`, `lon`, `heightM`).

## Schedule

- **Node**: 1 h before sunrise to 5 h after, plus a block around sunset, about ten hours a day, extended into the night in summer for crickets and frogs. The schedule is what makes a 50 W panel carry a Dutch December; it is set on the power scheduler before the box ships, not in the field. Acoustic-index variance stabilises after about 120 recording hours, so a schedule reads the same directions as a continuous stream.
- **Offline recorders**: birds 1 h before sunrise to 3 h after, plus 1 h around sunset, at 48 kHz. Summer addition for crickets and frogs 22:00 to 02:00. Bats sunset −30 min to sunrise +30 min, trigger-based, 256 to 384 kHz. The AudioMoth configuration app computes battery life for the schedule; a dawn/dusk schedule runs 6 to 8 weeks on three lithium AA cells.
- **A PUC on mains or a large panel** runs continuously.

Whatever the schedule, do not change it at a place once it is running. A longer listening window raises species counts on its own, which Diversity would read as life returning.

## Weatherproofing

- Node: IP65 enclosure, hinged lid, cable glands downward and tightened onto the actual cable diameter, a silica sachet inside, panel facing south at 30 to 45 degrees and mounted above the box so it shades it. The acoustic port is the one opening that is not sealed, so it faces down and carries a membrane.
- Offline recorders: the IPX7 case with a Porelle membrane vent; a silica sachet inside; lid seal checked at every swap.
- PUC: in the shade of its panel, panel facing south at 30 to 45 degrees, router in a barn with an external antenna if the field is more than 30 m away.
- Cable lock through the case loop. Recorders do get stolen; a €10 lock halves it.

## Maintenance

| Set | Interval | Do |
| --- | --- | --- |
| Node | nothing scheduled; look at "last seen" monthly | wipe the microphone port and the panel once or twice a year; check the post and the probe cable after field work |
| Offline sound (AudioMoth, Micro 2) | 6 to 8 weeks | swap microSD and batteries; check seal; photograph the mounting |
| Connected sound (PUC, BirdNET-Pi) | monthly | check uptime on the dashboard; wipe microphone port; check panel |
| Ultrasonic (Mini Bat 2) | 6 weeks (AA) / 3 to 4 months (Li-ion) | swap card and batteries |

## What to write in the device notes

Mount type, direction the microphone faces (compass), habitat within 50 m (hedge, ditch, crop), nearest noise source and distance, schedule used. These are read by verifiers and by anyone comparing places.
