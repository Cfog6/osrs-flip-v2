# Backlog

Ideas parked on purpose. Nothing here gets built until real-trade evidence (≥ 30 linked flips) or a bug makes the case,
and Jason approves it in DECISIONS.md.

- **Re-price holdings.** Holdings currently show the sell target from when the buy was recommended. Re-evaluate it as the market moves.
- **Push a warning before 72h.** A Discord ping when a holding is close to its max hold.
- **Buy-limit resets on long gaps.** An offer sitting 8–10h can buy more than one 4h limit. Quantity is currently capped at one limit, which is conservative.
- **Recency weighting.** All ~15 days of history count equally in the fill and exit odds.
- **5-minute data near session start**, for fresher bids.
- **RuneLite sample bias.** Compare wiki volumes against the official Jagex GE daily volume.
- **Size to actual cash** on the page, instead of the configured stake.
- **Auto-reload the Flipping Utilities file** (File System Access API) so the weekly import is one click.
- **Mobile layout polish.**
- **Sell target can sit too high.** Some picks (e.g. Super restore(3)) show ~0% odds of reaching the sell target, yet a positive value at 72h, which means a lower target would sell. Consider choosing the sell target like the bid: search a few levels and pick the best expected value.
