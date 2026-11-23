# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mixia666/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mixia666/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the protocols that record no token yet by what a launch would be worth. It reads a sealed DefiLlama snapshot, prices TVL the way the snapshot's own live tokens price it — each pre-token protocol is carried at the median market-cap-to-TVL multiple of its category's live comparables, shrunk toward the global median — then adjusts for seven-day growth, for how long the protocol has run with no token, and for how many chains it runs on. The board covers the whole 40-protocol watchlist plus every other launch candidate the same product screen finds, 198 rows in this snapshot, and every row carries a six-step farm plan with costs and times. The dashboard is a static page with a sortable, filterable board, a detail view per protocol that shows the model's arithmetic, and the comparables table the multiples are read from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The program is a Node 22 `main.ts` at the repository root, standard library only, and needs no install. In the grader it reads `/input/snapshot.json` and writes `/output` with no arguments. A run writes `board.json` (the ranked board), `data.js` (the dashboard's dataset), `dashboard/` and `screenshots/` (copied from this repository) and `dossier.json` (the judge's summary, written by the vendored make.fun library).

---

<sub>Entered on [make.fun](https://make.fun/?ref=vd2s8rmr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
