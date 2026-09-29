---
title: "Stage 5. Two weeks of not touching it"
short: "Watch four numbers from the desk. Anything that needed a visit becomes a line on the failure list."
order: 6
stage: "5"
produces: "confidence, and an honest failure list"
gate: "fourteen days with no intervention"
status: later
parts: []
---

# Stage 5. Two weeks of not touching it

![The node small in a misty agroforestry alley at dawn](../../public/img/build/s5-soak.webp "Rendered impression, not a photograph. The node earns trust by being boring for two weeks.")

**What it is.** Watch four things from the desk and resist touching anything: the lowest battery voltage each night, how many readings are waiting unsent, detections per day compared with day one, and whether the storage on the card keeps growing. Once in the fortnight, pull the panel lead for two days: the *silent* alarm must arrive after 36 hours and clear on the first heartbeat after power returns. The guard stays armed the whole time; a chirp nobody caused is a false alarm, goes on the list, and gets its threshold changed before the node goes to a farm.

```ai A daily check during the soak, and the report at the end
# Life Box build plan, 5-soak (https://life.oncra.org/lifebox/5-soak): A daily check during the soak, and the report at the end. Cold start? Read the first box on https://life.oncra.org/lifebox.
NODE=${NODE:-life@life-node-1.local}     # the Pi: user life, password "lifebox" unless NODE_PASSWORD was set in life-node.env
: "${LIFE_ADMIN_KEY:?export LIFE_ADMIN_KEY first: the oracle steward key from the plan maintainer, or your own oracle ADMIN_API_KEY}"
S=<place slug>; API=https://life.oncra.org/api/v1; H="authorization: Bearer $LIFE_ADMIN_KEY"
curl -s -H "$H" $API/places/$S/devices | python3 -c "import sys,json;[print(d['kind'],d.get('depthCm'),d['lastSeenAt'],d['lastHeartbeatAt']) for d in json.load(sys.stdin)['items']]"
curl -s -H "$H" "$API/places/$S/alerts?all=1" | python3 -c "import sys,json;[print(a['createdAt'][:16],a['kind'],'open' if not a['resolvedAt'] else 'closed') for a in json.load(sys.stdin)['items']]"
ssh $NODE 'df -h /data | tail -1; wc -l /data/life-node/queue.jsonl 2>/dev/null; journalctl -u birdnet-go --since today | grep -c detection'   # only while the node is awake
# Keep a small table (day, battery V from the Victron app, queue rows, detections, /data used) in kit/bench-log.csv notes or a new kit/soak-log.csv, by PR.
# On day 14: write the failure list (anything that needed hands) into the kit page's "Where this design is most likely to fail" section, by PR, and mark this page status: done.
```

## Gate

Fourteen days with no intervention. Anything that needed a visit becomes a line on the [kit page's failure list](../kit.md#where-this-design-is-most-likely-to-fail), which is where this design keeps its honesty.

## After the soak

Node 1 goes to its first site. The [HVHL](https://www.hvhl.nl) practice plots and the a.s.r. / Open Bodemindex farms are the candidates; the plan for them starts once this page's gate has passed, not before.
