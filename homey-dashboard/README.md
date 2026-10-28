# Homey Dashboard

A small Next.js app, hosted on Vercel, that shows a live view of your Homey: room-by-room
device status, a searchable list of all flows (enabled/disabled/broken), and an activity feed
built by watching device state changes (the closest available proxy for "a flow or script just
ran" — Homey's API does not expose a true "currently running" signal for flows).

## How it authenticates

Homey's simple "API Key" only works from your home network. To make this dashboard reachable
from anywhere, it uses the official Athom Cloud API OAuth2 flow instead:

1. You click "Connect to Homey" and log in through Homey's own consent screen.
2. The app exchanges the resulting code for an access + refresh token.
3. It looks up your Homey's `remoteUrl` (Athom's cloud relay) and logs into it with a
   delegation token, per the [Homey Web API HTTP spec](https://api.developer.homey.app/http-and-socket.io/http-specification).
4. Your session (encrypted) is stored in a secure, httpOnly cookie in your browser — there is
   no external database. Tokens refresh automatically.

## Deploying (PowerShell)

From this folder:

```powershell
npm install
npx vercel login          # one-time, opens a browser to authenticate
npx vercel link           # links this folder to a Vercel project (creates one if needed)
npx vercel deploy --prod  # first deploy; note the https://<project>.vercel.app URL it prints
```

## One-time setup

1. **Register an OAuth client** in the Homey Developer Tools at
   <https://tools.developer.homey.app/api/clients> (the **API → Clients** section; sign in with
   your Athom/Homey account). Click **New Client**.
   - Redirect URI: `https://<your-vercel-domain>/api/auth/callback` (the domain from the deploy
     step above)
   - Ensure the client includes the `homey.insights.readonly` scope for the Temperatures tab.
   - Note the **Client ID** and **Client Secret**.
2. **Set environment variables** in the Vercel project (Settings → Environment Variables, or via
   `npx vercel env add <NAME> production`):
   - `ATHOM_CLIENT_ID` — from step 1
   - `ATHOM_CLIENT_SECRET` — from step 1
   - `COOKIE_SECRET` — any long random string, e.g. generate one with
     `[System.Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Max 256 }))` in
     PowerShell, or `openssl rand -hex 32`. This only encrypts the session cookie; it is not a
     Homey secret.
3. **Redeploy** so the new environment variables take effect: `npx vercel deploy --prod`.
4. Open the site and click **Connect to Homey**.

No Homey "API Key" is needed anywhere in this setup — the OAuth login replaces it.

## Running on your own network (live updates)

The Vercel deployment is serverless, so it can't hold a persistent connection to Homey — it
polls every 20s. Hosting the app as a **long-running process on your LAN** (e.g. a NAS) unlocks
**live server-push updates**: the server polls Homey quickly and streams only changed devices to
the browser over Server-Sent Events (`/api/homey/stream`). This is enabled by the build-time flag
`NEXT_PUBLIC_LIVE=1` (set in the Dockerfile), and a 🟢 **Live** pill appears in the header. The 20s
poll remains as a safety net; on Vercel (flag unset) nothing changes.

### Docker (NAS)

```sh
# 1. Put your secrets in a .env next to docker-compose.yml:
#    ATHOM_CLIENT_ID=...
#    ATHOM_CLIENT_SECRET=...
#    COOKIE_SECRET=...            # openssl rand -hex 32
#    APP_BASE_URL=https://homey.your-nas.example   # the HTTPS URL you reach it at
# 2. Build & run:
docker compose up -d --build
```

**HTTPS is required.** Athom only allows **https** OAuth redirect URIs, and the session cookie is
`Secure` (won't be stored over plain http). So put the container behind your NAS's reverse proxy
with a TLS cert (Synology/Unraid both support this), then:

- Set `APP_BASE_URL` to that https URL.
- Register `https://<that-host>/api/auth/callback` as a redirect URI on your Homey OAuth client
  (in addition to the Vercel one) at <https://tools.developer.homey.app/api/clients>.

The server still reaches Homey via the Athom cloud relay (using your OAuth session); a future
step can switch it to Homey's **local** API + Socket.IO for true event-push and lowest latency.

## Project structure

- `app/page.js` — the dashboard UI (client-side, polls every 20s)
- `app/api/auth/*` — OAuth login/callback/logout/status routes
- `app/api/homey/*` — proxies that call your Homey via the Athom Cloud API
- `lib/homey.js` — Athom/Homey API client (token refresh, delegation login)
- `lib/sessionCookie.js` / `lib/crypto.js` — encrypted cookie session storage

## Version history

- **1.17.0** (2026-10-27) — Light modes come from AdaptiveLighting itself (2.28.0+), not a
  guess. The script publishes every light's state to the Logic text variable
  `AdaptiveLightingStatus`; the new `/api/homey/lighting` route reads it and one shared 15s poll
  (only while Lighting or Rooms 2.0 is open) feeds both tabs. Badges: Auto / Manual / 📌 forced
  profile, **Manual?** when the light differs from what the script last set but the script hasn't
  flagged it yet, and a trailing **?** when the script hasn't reported the light (or not for 3 h)
  and the old schedule comparison is used. Hover shows what the script applied, e.g.
  "Daytime · 32% (80% × 0.4 daylight, 250 lx) · colour 0.59 (sun 21.4°) · set 12:05". Daylight-
  and sun-adjusted lights no longer show as Manual.
- **1.16.1** (2026-10-27) — Lighting follows AdaptiveLighting 2.27.3: the weekend schedule
  switches at noon (Friday evening = weekend, Sunday evening = weekday) via the new
  `isWeekendScheduleNow()`; heating keeps `isWeekendNow()`. C LightStrip gets the kids' weekend
  profiles like C Loft (AL 2.27.2). The day curve shows the schedule in effect now, so before
  noon on Friday/Sunday its evening part still shows today's set.
- **1.16.0** (2026-09-03) — Rooms 2.0: new temperature forecast model. One physical model for
  every room (drift toward outdoors + internal gains; the radiator lifts toward the effective
  target but never above it) replaces the old "relax toward the setpoint" model, which drew rooms
  cooling toward a low night setpoint even with the valve closed. Parameters (heat loss, gains,
  radiator authority) are fit weekly from Insights; `/api/homey/temperatures` now also serves the
  tado target/heating-power and radiator-plug power logs for that. Pause = heating off; the rest
  of the current slot uses the valve's actual setpoint (includes inactivity/away offsets).
- **1.15.6** (2026-07-18) — Temperatures tab: y-axis uses whole-degree ticks at a nice step
  (1/2/5/10°) instead of fractional fifths of the range that rounded into an uneven scale
  (18, 20, 21, 23, 24, 26).
- **1.15.5** (2026-07-18) — Temperatures tab: sensor colours are assigned once from the full
  sensor list and reused by the checkbox swatches, chart lines, and tooltip — previously
  the chart coloured by index within the *selected* subset, so colours mismatched the
  checkboxes whenever not all sensors were selected.
- **1.15.4** (2026-07-18) — Graph card: footers swapped so the temperature footer sits at
  the very bottom (lights count + All on/off above it). Mobile: rooms separate visibly —
  bigger room title (20px) with a blue accent bar and more spacing between rooms.
- **1.15.3** (2026-07-18) — The scheduled heating target line (and its legend/tooltip) is
  now purple, leaving orange to the adaptive-lighting curve whose cool→warm gradient
  encodes white balance; the slot-band label text stays neutral grey.
- **1.15.2** (2026-07-18) — Unavailable devices (unpowered/unreachable, e.g. an unplugged
  Twinkly) show a ⚠️ icon and render dimmed in the light tiles and Status card, their
  switches are disabled, and "All on"/"All off" skips them.
- **1.15.1** (2026-07-18) — Rooms separate again (grouping by exact zone, as before 1.15.0);
  the window-open state reported by the heating system now shows as a row in the heating
  room's Status card ("🪟 Window open — heating paused") instead of the room header, while
  the physical sensor stays listed in its own sub-zone room. Empty Status cards say
  "Nothing to report."
- **1.15.0** (2026-07-18) — Sub-zones roll up into their room (home > building > room;
  deeper zones merge): Stue/Spisestue now shows all its sub-zone lights, window/door
  sensors, motion and devices in one row with a populated Status card. The room header is
  trimmed to name + mode badge — the window-open state lives in the Status card.
- **1.14.3** (2026-07-18) — Mobile friendly: below 760px each room stacks vertically with
  the compact Status card above the graph card (CSS grid breakpoint instead of the fixed
  two-column layout).
- **1.14.2** (2026-07-18) — Uniform chart-card title ("📈 Today") on every room; the
  weekend/weekday schedule note moved to the tab intro (it's the same for all rooms), and
  the adaptive legend continues to explain per-room content.
- **1.14.1** (2026-07-18) — Plugs re-classed as "Light" in Homey (virtualClass) are shown in
  the lights section, and "Always on" devices (energy setting) get a greyed-out, disabled
  switch everywhere — they're also skipped by "All on"/"All off".
- **1.14.0** (2026-07-18) — Rooms 2.0 layout rework: the lights section (phase chips, tiles,
  All on/off footer) moves into the main card under the temperature footer, and the left
  column becomes a **Status** card per room: motion inactivity duration, doors/windows with
  how long they've been open (capability timestamps now exposed by the devices/stream APIs),
  battery levels, and other devices (sockets, TV, appliances…) with on/off toggles.
- **1.13.1** (2026-07-18) — One chart style everywhere: lights-only rooms now use the same
  combined chart (brightness overlay, night dimming, sun/moon and now markers, hover) with
  the temperature elements simply absent. The separate day-ribbon component is removed.
- **1.13.0** (2026-07-18) — Merged chart: rooms with both lights and a climate graph now
  show one combined chart — temperature (left axis) and the adaptive-lighting brightness
  curve (right axis, 0–100%, cool→warm gradient area) share the time axis, with sun/moon
  markers, dimmed night hours, and brightness in the hover tooltip. The standalone day
  ribbon remains for lights-only rooms.
- **1.12.7** (2026-07-18) — Day ribbon: sunrise/sunset markers are now ☀️/🌙 and the night
  hours (before sunrise, after sunset) are dimmed with a grey overlay.
- **1.12.6** (2026-07-18) — "Exclude from climate" filter now matches the actual key used
  on this firmware: `settings.climate_exclude` (confirmed via the devices-debug dump).
- **1.12.5** (2026-07-18) — Temperature sensors honour the device's **"Exclude from
  climate"** setting: excluded devices no longer feed the Rooms 2.0 climate graphs or the
  Temperatures tab (checks the plausible flag locations on the raw device object, since
  the exact key is undocumented).
- **1.12.4** (2026-07-18) — All three panel footers (lights, heating, sensor-only) share a
  fixed content min-height (28px) so the bars render at identical heights.
- **1.12.3** (2026-07-18) — Footer alignment: the lights footer's action pills now use the
  exact metrics of the heating pills, and both panels pin their footers to the card bottom
  (flex column + `margin-top: auto`), so the two footers in a room row share the same
  height and sit on the same line.
- **1.12.2** (2026-07-18) — Lights panel footer now mirrors the heating section's layout:
  lights-on count (bold, left) with the "All on" / "All off" action pills right-aligned,
  separated by the same top border. Moved from the panel header.
- **1.12.1** (2026-07-18) — Light tiles: drop the redundant "on"/"off" text now that the
  switch shows the state; only the dim percentage is displayed (when on).
- **1.12.0** (2026-07-18) — Rooms 2.0 light controls: every light tile gets an on/off
  switch (optimistic, via the existing device-control endpoint), and the lights panel
  header gets "All on" / "All off" buttons that switch the whole room in one batched
  request.
- **1.11.3** (2026-07-18) — Forecast fixes: an open window now routes the room to the
  passive outdoor-drift model with the open state assumed to persist (it may stay open for
  days) — no more invented "closes in 20 min" dip toward an artificial floor. The response
  lag applies only to schedule lookups, not mode durations, and learned thermal statistics
  require ≥3 observed events before overriding defaults (a median of 2 is noise); lag
  clamp tightened to 60 min.
- **1.11.2** (2026-07-18) — Temperature sensor list now excludes non-responsive devices
  (deleted or `available: false`, e.g. the stale Køkken sensor) and "system" devices whose
  measure_temperature is a CPU temperature (detected via sibling capabilities like CPU
  cores/load/memory — e.g. the Homey Pro itself). Applies to both Rooms 2.0 and the
  Temperatures tab.
- **1.11.1** (2026-07-18) — Rooms 2.0 polish: overlapping heating slots (e.g. Clara's Day
  08–21 vs Evening 20–23:59) are now resolved with the script's first-match priority before
  drawing, fixing the diagonal artifact in the scheduled-target line and making the shown
  slot boundaries match what the script actually does. The measured line gets a light
  centered moving average (~9 min) to remove sensor-quantisation jaggies. Sensor-only rooms
  (no heating config) now show their current temperature under the graph.
- **1.11.0** (2026-07-18) — Passive (heating-off) forecast in Rooms 2.0: when the heating
  master switch is off — or a room has no heating config at all — the forecast now models
  the room drifting toward the outdoor temperature (dT/dt = k·(T_out − T_in) + c). The
  coupling k and internal-gain term c are fit per room by least squares over the last 7
  days of indoor vs. outdoor Insights data (tado outside sensor), and the forecast is
  driven by Open-Meteo's hourly outdoor forecast for the home's fixed location (NOT the
  browser's location, which the Weather tab uses). A ❄️ line under the graph shows the
  fitted time constant and data sources.
- **1.10.6** (2026-07-18) — Correct Insights entries URL, verified against Athom's own
  `homey-api` v3 client source: `GET /log/:uri/:id/entry` with `:uri` = `homey:device:<id>`
  and `:id` = the **full composite** log id (uri + bare capability kept as legacy fallback).
- **1.10.5** (2026-07-18) — Insights entries: also accept the `values` array response shape,
  and treat an empty result from one endpoint form as a miss (fall through to the legacy
  uri+capability endpoint) instead of returning zero samples.
- **1.10.4** (2026-07-18) — Root cause of the missing measurements found and fixed: current
  Homey firmware identifies Insights logs by a single composite id
  (`homey:device:<id>:measure_temperature`) instead of the older uri + bare capability id,
  so the temperatures API matched zero logs (`sensors: []`) — breaking both the Temperatures
  tab and Rooms 2.0. The route now normalises both formats and fetches entries via the
  composite-id endpoint with a legacy fallback. Verified against the live Homey API.
- **1.10.3** (2026-07-18) — Temperature history is now fault-tolerant end-to-end: the API
  fetches each Insights log independently (one broken/stale log no longer 500s the whole
  request and blanks every room's measured line), and Rooms 2.0 keeps whatever chunks
  succeeded instead of discarding everything on a partial failure.
- **1.10.2** (2026-07-18) — Fix the Insights sensor→device mapping in the temperatures API:
  a device log's owner is identified by its `uri` (`homey:device:<id>`), not `ownerId`, which
  was empty — so sensors carried no device id and no zone, breaking room matching in Rooms 2.0
  (and putting sensors under "Uden rum" in the Temperatures tab). With the heating master
  switch off, Rooms 2.0 now draws a flat "temperature holds" forecast instead of nothing.
- **1.10.1** (2026-07-18) — Rooms 2.0: history sensors now match rooms by **device id**
  (zone-path string matching was fragile and could silently drop the measured line), today's
  series is fetched in chunks of 40 (the API's per-request cap), and every empty state is
  explained on the card — e.g. "heating system is switched off — forecast disabled" or "no
  Insights temperature log matched this room" — instead of silently drawing nothing.
- **1.10.0** (2026-07-18) — Rooms 2.0 forecast now **learns each room's thermal response**
  from the last 7 days of Insights data (new `lib/thermal.js`): the dead time between a
  thermostat setpoint change and a measurable room-temperature reaction (lag), and separate
  heating/cooling time constants, estimated from every scheduled setpoint step observed in
  the past week (medians, clamped, defaults when history is thin). The dashed forecast uses
  the learned lag + taus, and a small 🧠 line under each graph shows what was learned.
- **1.9.1** (2026-07-18) — Rooms 2.0 fixes: the climate panel (graph + heating controls) now
  renders for every heating-configured room even when Insights history is unavailable (it
  previously vanished silently), history-fetch errors are surfaced, and sensors also match by
  room name. The adaptive-lighting ribbon was redesigned: a smooth glowing brightness curve
  with a continuous cool→warm colour gradient replaces the dark blocky bars.
- **1.9.0** (2026-07-18) — New experimental **Rooms 2.0** tab (the original Rooms tab is kept):
  one full-width row per room. Lights are shown as live glowing tiles under a 24h
  adaptive-lighting "day ribbon" (sky gradient, brightness/white-balance curve, sunrise/sunset
  and now markers, clickable phase chips that apply a phase now). Rooms with temperature sensors
  get a today-since-midnight temperature graph with the room_heating schedule overlaid (slot
  bands + target step line) and a dashed first-order forecast for the rest of the day that
  honours boost/pause/manual modes and open windows. Inline heating controls (target ±,
  Boost/Pause/Reset). Heating config moved to shared `lib/heating.js`.
- **1.8.0** (2026-07-18) — New **Temperatures** tab: automatically discovers every device
  temperature log in Homey Insights, plots any checked combination, remembers the selected sensors,
  and dynamically reloads the chart for 6h, 24h, 7d, 14d, or 31d periods. Includes sensor search,
  select/clear-all controls, min/max summaries, and hover values across all visible series.
- **1.7.0** (2026-07-06) — Flatten navigation into a single tab row (Weather · Rooms · Live activity ·
  Heating · Adaptive lighting) — no more nested Home sub-tabs. Weather is still the public landing;
  clicking a Homey tab prompts login if needed (callback returns to `?tab=rooms`). Removed the
  status count pills and shrank the refresh to a small icon. (App version now shown as v1.7.0.)
- **1.6.13** (2026-07-06) — Heating: cap the target at Tado's max 25°C (was 30); disable +/- at the
  5–25° limits.
- **1.6.12** (2026-07-06) — Heating +/- sends only `target_temperature` (was also sending `onoff:true`,
  which can make Tado resume its schedule and discard the overlay) and holds the new setpoint on
  screen for 45s through Tado's propagation so it doesn't flicker back to the old value.
- **1.6.10** (2026-07-06) — Show the app version (`vX.Y.Z`) in the header so the running build can be
  confirmed after a rebuild (deploy verification).
- **1.6.9** (2026-07-06) — Heating: +/- now shows a sticky optimistic ✋ Manual badge immediately
  (kept until the script publishes the real manual status, so no flicker) instead of waiting minutes
  for the cron; surface per-capability write errors; poll heating status every 15s (was 30s).
- **1.6.8** (2026-07-06) — Fix target steppers: `/api/homey/set` was silently dropping
  `target_temperature` (and `windowcoverings_set`) — not in its capability whitelist — so setpoint
  changes had no effect. Added them; the heating +/- now drives the live device setpoint (also fixes
  the Rooms-tab thermostat stepper).
- **1.6.7** (2026-07-06) — Heating: −/＋ steppers to manually set a tado room's target (0.5° steps,
  `/api/homey/set`), which trips the script's manual override; shows the `manualOverrideDuration`
  (90 min) hint and reuses the ✋ Manual badge + countdown. Disabled when the master switch is off.
- **1.6.6** (2026-07-06) — Heating: disable the per-room Boost/Pause/Reset buttons when the master
  switch is off (greyed-out state).
- **1.6.5** (2026-07-06) — Heating: grey out (desaturate + dim) the room cards when the master switch
  is off, to show the whole system is disabled.
- **1.6.4** (2026-07-06) — Heating cards show a live inactivity timer (like the Rooms page), tied to
  the config's `inactivityTimeout`: 💤 counts up since motion cleared and shows "−X° in m:ss" until
  the timeout, then "−X° applied" once the inactivity offset kicks in.
- **1.6.3** (2026-07-06) — Heating: Boost/Pause/Reset (and the master switch) update the UI instantly
  via an optimistic mode badge, then re-poll `HeatingStatus` at 1.5/3.5/6s to reconcile with the
  script's real value — no more multi-second wait for the badge to appear.
- **1.6.2** (2026-07-06) — Heating: read the new `HeatingStatus` Logic variable (published per-run by
  room_heating.js v10.17.0) to show live **mode** (🔥 Boost / ⏸ Paused / ✋ Manual / 🚪 away) with the
  **remaining boost/pause time**, plus the script's own effective target / window / inactive state
  (falls back to device data if the variable isn't there yet).
- **1.6.1** (2026-07-06) — Heating: master on/off switch (writes the `HeatingEnabled` Logic variable;
  OFF also triggers the "Heating switched off" flow). Each room card now shows the scheduled slot +
  target (mirrored from room_heating_config.js), whether the set target is reduced, window state, and
  active/inactive with the idle offset — so it's clear why heating is on or off.
- **1.6.0** (2026-07-06) — New **Heating** tab (Home sub-tab): per-room thermostat status (current
  temp, target, tado heating-power bar, humidity, window-open) for the room_heating rooms (Stue,
  Soveværelse, Oliver tado valves; Clara smart-plug), plus the global `HeatingEnabled` state
  (`/api/homey/heating`). Boost / Pause / Reset actions trigger the mapped room_heating flows
  (auto-guessed by name, configurable + saved in localStorage).
- **1.5.6** (2026-07-06) — Active motion shows a pulsing green "live" dot (radar-style ring pulse)
  instead of the static 🏃 tag.
- **1.5.5** (2026-07-06) — Battery indicator mid-level colour changed from amber (#d97706) to a
  yellower #eab308.
- **1.5.4** (2026-07-06) — Inactivity display: use 💤 for all durations (dropped the 😴 face); show
  m:ss per second under 30 min, then switch to a per-minute counter (e.g. "45m", "1h 5m") instead of
  a static "Inactive" label.
- **1.5.3** (2026-07-06) — Fix reverse-geocoded place name: Nominatim's `zoom=12` mis-snapped some
  points (Østerbro → "Sundbyerne"). Now request the full address and pick suburb + city
  (e.g. "Østerbro, Copenhagen, DK"). Browser coords were correct; only the label was wrong.
- **1.5.2** (2026-07-06) — Weather location: request a fresh high-accuracy fix (was allowing a 1h
  cached, coarse position), show the resolved coordinates, and add a **city search** picker
  (`/api/weather/search`, Open-Meteo geocoding) so location can be set precisely when browser/IP
  geolocation is off. Corrected the default point to actual Østerbro.
- **1.5.1** (2026-07-06) — Weather auto-detects location via the browser Geolocation API (cached in
  localStorage, "Use my location" button), with Copenhagen as fallback. `/api/weather` now takes
  `lat`/`lon`, uses `timezone=auto`, and reverse-geocodes the place name (Nominatim/OSM).
- **1.5.0** (2026-07-06) — Restructure navigation into two top-level tabs: **Weather** (public
  landing, no login) and **Home** (Homey, auth-gated). The Home tab prompts for the Homey login only
  when opened, and contains Rooms / Live activity / Adaptive lighting. Post-login returns to Home
  (`?tab=home`). The standalone Flows tab was removed from the nav (flows data still powers the
  lighting reset dropdown).
- **1.4.2** (2026-07-06) — Weather: show wind in m/s (request `wind_speed_unit=ms` from Open-Meteo).
- **1.4.1** (2026-07-06) — Weather: cross-check with MET Norway / YR (locationforecast, with the
  required identifying User-Agent). Current shows both sources' temps + a consensus chip (agree vs.
  differ), and the 7-day rows show YR's high/low alongside Open-Meteo's. Attribution added.
- **1.4.0** (2026-07-06) — New **Weather** tab: current conditions, next-24h strip, and a 7-day
  forecast for København Ø via Open-Meteo (no API key), through a cached `/api/weather` route.
- **1.3.5** (2026-07-06) — Move the motion (active/inactivity) status to the room card's top-right
  corner instead of the tag row.
- **1.3.4** (2026-07-06) — Inactivity timer: fix it jumping to minutes on clear (seed from "now" when
  we observe motion clear; use the zone's stale `activeLastUpdated` only for already-idle-on-load),
  and add a hover tooltip showing the time of last activity.
- **1.3.3** (2026-07-06) — Rooms with a motion sensor show an inactivity timer (💤 m:ss) counting up
  since motion cleared — seeded from the zone's `activeLastUpdated`, live via the sensor — and after
  30 min it collapses to a 😴 Inactive label. Shows 🏃 motion while active.
- **1.3.2** (2026-07-06) — Hide grouped bulbs: devices that are members of a light group (they carry
  a `group` id) are filtered out of the devices API and stream, so rooms show the group device (e.g.
  "ST Loft") instead of its individual member bulbs. Added `/api/homey/devices-debug` (diagnostic).
- **1.3.1** (2026-07-06) — Room tiles show a "light strip": one swatch per light coloured by its
  live colour/temperature (hue in colour mode, else warm/cool from `light_temperature`), glowing when
  on and faded by brightness.
- **1.3.0** (2026-07-05) — Interactive device controls in the expanded room view: on/off toggle,
  brightness + warmth sliders, curtain position, and thermostat setpoint (each shown only when the
  device supports it), with optimistic updates via `/api/homey/set`.
- **1.2.3** (2026-07-05) — Fix room ordering: this Homey's cloud API exposes no zone-order field, so
  sort rooms by their full **zone path** (level-by-level, Danish collation, parents before children)
  in both the Rooms grid and the Adaptive lighting tab. Added `/api/homey/zones` (diagnostic).
- **1.2.2** (2026-07-05) — When the live stream is connected, stop the redundant 20s poll: fall back
  to a slow 120s background re-sync (flows list + stall recovery) and drop the countdown from the
  Refresh button (it just reads "Refresh now").
- **1.2.1** (2026-07-05) — Fix client-side crash from v1.2.0: the merged-feed `useMemo` was placed
  after the auth early-returns (conditional hook call). Moved it above them.
- **1.2.0** (2026-07-05) — Merge Homey Timeline **notifications** into the Live activity feed
  (`/api/homey/notifications`), shown with a 🔔 and blue accent alongside device-state changes and
  sorted by time. New notifications also stream live over SSE (polled ~every 10s in the stream loop).
- **1.1.1** (2026-07-05) — Live stream: send `X-Accel-Buffering: no` so a reverse proxy (Synology
  nginx) doesn't buffer/batch SSE events.
- **1.1.0** (2026-07-05) — Optional live server-push updates over SSE (`/api/homey/stream`) for the
  self-hosted build: a long-running server (NAS/Docker) streams changed devices to the browser in
  ~2.5s, shown by a 🟢 Live pill. Added a standalone Docker build (Dockerfile + docker-compose).
  Gated by `NEXT_PUBLIC_LIVE=1`, so the Vercel deployment is unchanged (still 20s polling).
- **1.0.12** (2026-07-05) — Adaptive lighting: one timeline per room (a representative schedule)
  instead of one per distinct light template; tapping a phase still applies each light's own
  template values, and all of the room's lights are listed under the single chart.
- **1.0.11** (2026-07-05) — Adaptive lighting: tap a phase chip (Morning/Daytime/Evening/Night) to
  set that group's lights to those brightness/temperature settings now, via a new `/api/homey/set`
  route (direct `homey.device.control` — no script needed).
- **1.0.10** (2026-07-05) — Adaptive lighting reset is now per-room (one reset flow per area, not
  per bulb), and the flow dropdown is filtered to light-reset flows (excludes heating-reset flows).
- **1.0.9** (2026-07-05) — Adaptive lighting reset now triggers the user's "light reset" flows
  (`homey.flow.start`) instead of running HomeyScript directly — OAuth Web API clients are barred
  from app/script scopes (403 Missing Scopes). Each light picks its reset flow from a dropdown
  (auto-guessed by name, saved in localStorage); `/api/homey/reset` triggers the chosen flow.
- **1.0.8** (2026-07-05) — Adaptive lighting: show per-light Auto/Manual/Off status (live dim/temp
  vs. the scheduled phase) and add "Reset to Auto" actions that run the AdaptiveLighting HomeyScript
  with the device id (same as the light-reset flows), via a new `/api/homey/reset` route.
- **1.0.7** (2026-07-05) — New "Adaptive lighting" tab: visualizes the circadian schedule from the
  `adaptivelighting.js` script as per-room 24h charts (bar height = brightness, color = white
  balance), with sunrise/sunset resolution, a live "now" marker, and a weekday/weekend toggle.
- **1.0.6** (2026-07-05) — Show the room's lowest battery as a battery glyph in each room-card
  header, and order the room cards by Homey's hierarchical zone `order` (was alphabetical).
- **1.0.5** (2026-07-05) — Battery: move the percentage number inside the battery glyph (centered,
  with a white halo for legibility over the colored fill).
- **1.0.4** (2026-07-05) — Battery levels now render as iOS-style battery glyphs with an inline
  percentage and green/amber/red color coding (≤20% red, ≤50% amber, else green).
- **1.0.3** (2026-07-05) — Merge the countdown into the refresh button: a single "Refresh now · Ns"
  button whose interior fills as a progress bar toward the next auto-refresh.
- **1.0.2** (2026-07-05) — Add a "Refresh now" button and a live countdown ring showing when the
  next auto-refresh (every 20s) will run; manual refresh resets the countdown.
- **1.0.1** (2026-07-05) — Fix OAuth: use standard `response_type=code` on the authorize call and
  `code` + `redirect_uri` on the token exchange (Athom rejected the previous `authorization_type`/
  `authorization_code` param names). Correct the OAuth-client portal URL to
  <https://tools.developer.homey.app/api/clients>.
- **1.0.0** (2026-07-05) — Initial version: OAuth2 login, room/device status grid, flows list,
  and a device-state-change activity feed.
