# Phone connection test

Use a deployed HTTPS build with a KV database and the three `XIRSYS_*`
environment variables configured in Deno Deploy. The site's `.env` file is
local only and is excluded from deployment.

1. Open the game on the phone. On the desktop, open `/admin` and join the
   phone's world. Record the selected `route`, join time, median RTT, and p95
   after about one minute (32 ping samples). Walk both players back and forth
   and note any visible pauses or corrections.
2. Close the desktop admin tab and reload the phone game to start a fresh
   world. Open `/admin?relay=1` on the desktop and join it. Confirm the route
   reads `relay/relay`, then record the same values. This measures a forced
   TURN path.
3. Turn off Wi-Fi on the phone so it uses cellular data. Reload the phone
   game and repeat the normal `/admin` join. Record whether it connects
   directly (`host` or `srflx`) or selects a `relay` candidate.
4. Repeat on cellular with `/admin?relay=1`. Keep the desktop on the same
   network throughout the comparison.

The admin panel's RTT is an application ping from admin to the phone host and
back. It is not a frame time or one-way latency measurement. A local desktop
tab pair gives a useful code baseline, but the phone tests measure the route
and network conditions players will actually use. If a trial fails, record
the status shown on each screen and which route was requested.
