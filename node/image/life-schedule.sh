#!/bin/bash
# Life node: put the season's Witty Pi schedule in place. Summer (Mar-Oct) is about ten hours a day from
# 05:00, winter (Nov-Feb) is one hour a day from 07:00 at a fixed clock time so the winter sample does not
# drift around the daily cycle. SCHEDULE=bench in the env file overrides both with 15 minutes in every hour.
# Run at every boot; only touches the Witty Pi when the wanted schedule differs from the one in place.
set -u
W=/data/wittypi
set -a; [ -f /data/life-node/env ] && . /data/life-node/env; set +a
case "${SCHEDULE:-season}" in
  bench)  want=bench ;;
  summer) want=summer ;;
  winter) want=winter ;;
  *) m=$(date +%-m); if [ "$m" -ge 3 ] && [ "$m" -le 10 ]; then want=summer; else want=winter; fi ;;
esac
src=/usr/share/life-node/schedules/$want.wpi
if [ ! -f $W/schedule.wpi ] || ! cmp -s "$src" $W/schedule.wpi; then
  cp "$src" $W/schedule.wpi
  echo "life-schedule: applying $want schedule"
  (cd $W && ./runScript.sh >> $W/schedule.log 2>&1)
else
  echo "life-schedule: $want schedule already in place"
fi
