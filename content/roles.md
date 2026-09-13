---
title: "Roles and user profiles"
summary: "Who does what in a life-oracle network: steward, installer, verifier, consumer, methodologist, operator, and software agents."
order: 10
---

# Roles

The oracle is a commons. These are the people (and programs) who keep it honest, in the order they usually appear at a place.

## Steward

Answers for a place. Registers it, decides what is public, invites installers, reads the verdict, carries the consequences. A farmer, a land trust, a municipality, a school. Holds a **steward key** scoped to the place. Can recompute readings and register devices. Cannot file visits about their own place.

## Installer / node host

Buys, mounts and connects hardware; often a local volunteer, a student, an agricultural adviser or a contractor serving many stewards. Works with the steward's key or their own unscoped steward key. Their product is a device that shows "last seen" every interval for five years. The [hardware](/docs/hardware) and [installation](/docs/install-sound) pages are written for them.

## Verifier

Visits places: 5% per year by public random draw, plus every place whose streams disagree, plus baselines for new carbon claims. Takes soil cores, eDNA, insect counts, photos; files a **visit** with findings. Independent from the steward; paid by the consumer of the verdict or by the commons, never by the steward directly. Holds a **verifier key**. Findings calibrate the models and feed the drift ledger.

## Consumer

Anyone who pays or decides on a verdict: a carbon registry (Oncra first), a bank, an insurer, a food buyer, a subsidy scheme, a researcher. Reads verdicts and evidence by API, pins a method version, weights by maturity. A **consumer key** is for attribution and rate limits; reading public places needs no key at all.

## Methodologist

Proposes changes to the seven readings, the season rules, the confidence model, the disagreement rules. Works in the open: a pull request against `src/lib/readings.ts` and `content/spec.md`, with the evidence. Changes ship as a new method version; old verdicts keep their version.

## Operator

Runs an instance: this one at life.oncra.org, or a national, bioregional or organisational fork. Holds the admin key, issues steward and verifier keys, keeps the worker running, publishes the drift ledger. An operator cannot change a verdict by hand; there is no endpoint for it.

## Software agent

Any program that closes a loop against life: a farm-advice agent that checks whether its advice made the place thrive, a registry that gates credits, a funder's agent that releases a tranche. Reads `/api/v1/places/<id>` and `/api/v1/openapi.json`. Agents are consumers with better manners: they should pin a method version and respect `insufficient`.

## The place itself

Has no key and the final word.

## Governance (specified)

Method versions are released by an open methodology group with a published change log; any operator may fork. The reference instance publishes the drift ledger. No single organisation, including Oncra, can change the method for everyone. Details in the [specification](/docs/spec), section 6 and 11.
