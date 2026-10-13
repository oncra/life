#!/usr/bin/env bash
# KNMI open data: hourly rain (RH) and daily Makkink reference evaporation (EV24) for Twenthe (290), Hupsel (283)
# and Heino (278), 2008-2020, into the directory given as the first argument.
set -euo pipefail
out=${1:?directory}; mkdir -p "$out"
for st in 290 283 278; do for y in $(seq 2008 2020); do
  curl -s -X POST https://www.daggegevens.knmi.nl/klimatologie/uurgegevens -d "start=${y}010101&end=${y}123124&vars=RH&stns=${st}&fmt=json" -o "$out/h_${st}_${y}.json"
done; done
curl -s -X POST https://www.daggegevens.knmi.nl/klimatologie/daggegevens -d "start=20080101&end=20201231&vars=RH:EV24&stns=290:283:278&fmt=json" -o "$out/daily.json"
