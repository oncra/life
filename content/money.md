---
title: "How a place could earn"
summary: "A design for paying land stewards on a verified life state: a published tariff per hectare-season, a connection payment so nobody fronts the hardware, and release as confidence grows. Proposal, open for comment. Nothing is being paid yet."
order: 6
---

# How a place could earn

**Status: a design, open for comment. No money is flowing through this yet, and nobody should plan around it as though it were.** This page exists because a measurement standard that never says how it connects to payment is only half an argument, and because the design decisions below are the ones most likely to be wrong in a way that matters. Argue with them by pull request.

## The problem this is aimed at

The [green paper](greenpaper.md) says the scarce thing in nature finance is affordable proof, not money. The numbers behind that, checked in September 2026:

- Payments for ecosystem services run at roughly **$36 to 42 billion a year across more than 550 programmes** worldwide, almost all of it public money for watersheds and forests.
- Against that, the entire **voluntary biodiversity-credit market sold about $3.2 million in 2025**. It is not the place to look for scale.
- The money that does reach stewards is slow and expensive to administer. Tropical payment schemes run **7% to 40% of budget on administration**, and one long-running national programme pays one to two years in arrears. Corporate soil-carbon programmes have left farmers waiting two years or more, with the delay attributed to audit timelines.
- Meanwhile European farms face an estimated **€1,400 to €4,100 per hectare** of unfunded transition cost, with current incentives covering a few percent of it.

So the opportunity is not a new credit. It is to make the existing money arrive sooner, cost less to check, and reach places that are currently too small to be worth verifying. A twelve-hectare farm cannot carry a €400 ecologist visit. It can carry a share of a €300 sensor that runs for five years.

## The unit

A **hectare-season of verified state**. Not a tonne, not a score, not an estimate of how much biodiversity exists.

A place earns for a season in which its verdict is **thriving** or **holding** at a stated confidence, judged against its own history and the crowd of neighbours on the same soil under the same weather. **Declining** earns nothing. **Insufficient** earns nothing and says exactly why. Because the verdict is the weakest of the seven readings and never a weighted sum, nothing can be bought with something else: a place cannot trade diversity away for greenness.

**Autonomy is one of the seven readings, and that is deliberate here.** A place that holds a living state with little management earns the same as one held up by constant intervention. A tariff that paid only for visible effort would breed gardeners and quietly penalise wildness.

## How it would pay

- **Connection payment** when a node reports its first complete season, sized to cover the hardware, so that no steward has to front the cost of being measured. Recovered from later payments only if the place declines; forgiven if it holds.
- **Seasonal payment** per hectare on each verdict, settled within thirty days of the season closing.
- **Maturity release.** Part of each seasonal payment is held and released as the reading's maturity grows, the same logic as issuing carbon for the lower bound of a range. Uncertainty then costs a steward time rather than laboratory fees, and the design rewards keeping a place alive for years rather than passing one inspection.
- **Visits are paid by the payer, never by the steward**, and are triggered by disagreement between streams plus a random draw. Nobody knows in advance who is checked, and nobody can buy a clean audit.

## What it would cost to run

| | Per hectare per year |
| --- | --- |
| Node, at 20 ha and a five-year life | €2.50 to €6 |
| Visits, at 5% random plus triggered | about €2 |
| **All-in verification** | **under €10** |

Set against per-hectare payments that already exist elsewhere in the range of €20 to €100, and against administration that elsewhere consumes 10% to 40% of the payout.

**One caveat that has to travel with those numbers, because it is the honest version of the argument.** Sensors are not cheaper than a person for a single measurement. The one clean published comparison, across forty farmland sites, put a single in-person survey at about AU$114 per site and passive acoustic monitoring at about AU$473. **For one snapshot a human is four times cheaper.** The same study found acoustic monitoring produced roughly seventy times more detections and twenty more species per site, and became the cheapest option per species from the fifth repeat campaign onward.

So the claim is not that measurement is cheap. It is that **continuous measurement is cheap and a single measurement is not**. An instrument that is installed once and then reports every season, for years, is a different economic object from a visit. It is also the only way to obtain a within-season signal that can be corrected for weather against neighbouring places, which is what makes a payment defensible at all. A tariff somewhere in the range of **€30 to €50 per hectare per year** would sit inside what payers already pay, cover measurement several times over, and be meaningful at smallholder scale, where one long-running national scheme pays about €40 per hectare for a small holding.

## Three roles that must not be merged

This is the part most likely to go wrong, so it is stated as a rule rather than an intention.

1. **The oracle** publishes readings. It is paid by those who *read* verdicts, never by those it measures, and never per positive verdict. It has no financial interest in a place thriving.
2. **The payer** publishes a tariff and pays on the oracle's public API. It does not compute readings.
3. **The registry** issues whatever certificates follow, under its own rules.

Collapse any two of these and the meter starts working for the person being measured. Every incentive failure in this field has that shape.

## Rules taken from other people's mistakes

The [specification](spec.md), section 5b, carries nine measurement rules learned from the audit record of the largest programme that pays smallholders on satellite data, set out in [Prior art](prior-art.md). Four of them are about money specifically:

- **Never credit a change smaller than the instrument error.** Issue for the lower bound; a range spanning zero pays nothing.
- **Publish money paid per steward per season, never stewards enrolled.** Enrolment is a vanity metric, and the gap between the two is where this field loses its credibility.
- **A visit that is not reproducible is not ground truth.** In the record we studied, the human fieldwork failed audit more often than the satellite did.
- **Before any payment flows in a country, establish what the state claims.** Rights to an ecological outcome may already be spoken for by a national programme. One letter of no objection is the difference between a working network and thousands of farmers frozen mid-payment.

## What has to be true before a single euro moves

- **The neighbour crowd must exist in that region.** Without it a drought reads as decline, and a place would be punished for the weather. This is built for a place's own history but not yet across a regional crowd, and it is the gate on everything here.
- **The disagreement rule and the random draw must be running**, or the anti-gaming argument is theoretical.
- **The drift ledger must be published**, so that the method's own error is countable rather than asserted.

Until those hold, this page is a design and not an offer.

## Payment rails

Nothing here needs a new financial instrument or a token. Bank transfer within Europe, batch payouts to mobile money elsewhere at well under one percent, and a local cooperative or collective as the payee where individuals have no account. The rails are the solved part of this problem; verification is not.
