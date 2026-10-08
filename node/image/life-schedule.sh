#!/bin/bash
# Life node: get the clock right, then put the season's Witty Pi schedule in place. Run at every boot.
#
# The clock first, because every alarm the Witty Pi sets is read against its own RTC. UUGear's daemon copies the
# RTC into the system clock at boot and switches NTP off when it does, so an RTC that was never set holds the node
# at the wrong time for good, and a schedule computed from it shuts the node down a minute after boot (node 1,
# 2026-10-05). Here NTP goes back on, the node waits up to CLOCK_WAIT seconds for a sync, and a synced clock is
# written into the RTC. Without a sync the RTC is trusted only if it is not behind the last time the clock was known
# good; otherwise no shutdown is scheduled, the node stays on, and systemd runs this again in five minutes.
#
# Then the schedule. Summer (March to October): DAY_HOURS from civil dawn and DUSK_HOURS from sunset (default 8 and
# 2), computed for the node's own place by life-schedule-wpi, so the dawn chorus, the evening chorus and the first
# hours of the bats are all inside a window. Winter (November to February): one hour from 07:00 at a fixed clock
# time, so the winter sample does not drift around the daily cycle. SCHEDULE=bench: 15 minutes in every hour.
# SCHEDULE=none: no schedule, the node stays on (desk work).
set -u
W=/data/wittypi; STATE=/data/life-node
set -a; [ -f $STATE/env ] && . $STATE/env; set +a
wp() { (cd $W && . ./utilities.sh >/dev/null 2>&1 && "$@"); }

timedatectl set-ntp true >/dev/null 2>&1
synced=no
for _ in $(seq 1 "${CLOCK_WAIT:-180}"); do
  if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ]; then synced=yes; break; fi
  sleep 1
done
last=$(cat $STATE/clock-ok 2>/dev/null || echo 0)
if [ $synced = yes ]; then
  wp system_to_rtc >/dev/null && date +%s > $STATE/clock-ok
  echo "life-schedule: clock synced ($(date '+%F %T %Z')), written to the RTC"
elif [ "$last" -gt 0 ] && [ "$(date +%s)" -ge "$last" ]; then
  echo "life-schedule: no time sync within ${CLOCK_WAIT:-180}s; trusting the RTC ($(date '+%F %T %Z'))"
else
  why="never synced"; [ "$last" -gt 0 ] && why="behind the last good time, $(date -d @"$last" '+%F %T')"
  echo "life-schedule: clock not trusted ($(date '+%F %T %Z'): no sync, $why); no shutdown scheduled, retrying"
  wp clear_shutdown_time
  exit 1
fi

# SCHEDULE=none: no schedule at all, for work on the desk. The clock above is still set; the node stays on until
# someone shuts it down, and the Witty Pi's default ON brings it back when power returns.
if [ "${SCHEDULE:-season}" = none ]; then
  rm -f $W/schedule.wpi
  wp clear_shutdown_time; wp clear_startup_time
  echo "life-schedule: SCHEDULE=none, no schedule; the node stays on"
  exit 0
fi

case "${SCHEDULE:-season}" in
  bench)  want=bench ;;
  summer) want=summer ;;
  winter) want=winter ;;
  *) m=$(date +%-m); if [ "$m" -ge 3 ] && [ "$m" -le 10 ]; then want=summer; else want=winter; fi ;;
esac
if [ $want = summer ] && /usr/local/sbin/life-schedule-wpi > $W/schedule.wpi.new 2>/dev/null; then
  :
else
  # the fixed summer script (10 h from 05:00) stays as the fallback if the computation fails
  cp /usr/share/life-node/schedules/$want.wpi $W/schedule.wpi.new
fi
mv $W/schedule.wpi.new $W/schedule.wpi
echo "life-schedule: applying $want schedule"; grep -v '^#' $W/schedule.wpi | tr '\t' ' ' | paste -sd ';'
# always run it, now that the clock is right: the daemon already ran the script at boot, possibly on the wrong time
(cd $W && ./runScript.sh >> $W/schedule.log 2>&1)
tail -n 4 $W/schedule.log | grep -E 'Schedule next' || true
