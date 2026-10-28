# Homey-opsætning, snapshot 10. oktober 2026

Optaget før ændringer i enheder (fx Hue Bridge Pro). Hentet read-only fra Homey Pro via Homey MCP og Homey Developer Tools, samt dette repo.

**Det er en oversigt, ikke en backup.** Flows er gemt som kort-resuméer uden ledninger og koordinater. Skal noget gendannes, er det Homeys egen cloud-backup (Indstillinger › Backups), der gælder. Tag en manuel backup lige før du går i gang.

Filer:
- `devices.tsv`: alle 93 enheder med id, driver, model og Matter-node
- `flows-standard.json`, `flows-advanced.json`: resumé af alle 46 flows (22 standard, 24 advanced)

## Det skal overleve, hvis enheder parres om

Parres en enhed om (fx ved skift til Hue Bridge Pro), får den et nyt Homey-id. Det rammer fire steder:

1. **Flow-kort, der peger direkte på enheden.** Se tabellen "Enhed → brug" nedenfor.
2. **HomeyScript-argumenter med enheds-id.** AdaptiveLighting, GradualFadeOut og RestoreSavedSettings kaldes med gruppens id som argument fra light flows.
3. **Hårdkodede id'er i scripts:** `adaptivelighting.js` (rum-config, motion-sensorer), `room_watchdog.js`, `evedevicemonitor.js`, og i dashboardet `lib/adaptiveLighting.js` og `lib/heating.js`.
4. **Navne og zoner, som scripts søger på:**
   - Lys-scripts finder gruppens pærer ved navne-præfiks: medlemmer af "K Loft" skal hedde "K Loft 1", "K Loft 2" osv. og have klassen `light`. Ellers falder de tilbage til samme zone.
   - De 8 Homey-grupper (K Loft, ST Loft, SV Loft osv.) indeholder Hue-pærer. En pære, der parres om, falder ud af gruppen og skal tilføjes igen.
   - Room Heating finder varmekilder via zone og klasse/virtuel klasse `heater`. C Radiator 1 og 2 er Hue Smart Plugs med virtuel klasse heater.
   - De fleste flows trigges af **zone aktiv/inaktiv/alarm**, ikke af sensoren direkte. Det kræver, at sensoren står i den rigtige zone med samme indstilling for zoneaktivitet (tabel nedenfor).

Hue-kontakterne (dimmer switches) bruges ikke i nogen Homey-flow. Deres knap-opsætning ligger i Hue Bridge og skal flyttes dér.

## Fund ved gennemgangen

- **O - Light flow** trigges af knapperne på **BILRESA dual button**, som er offline. Slettes IKEA-enhederne, forsvinder de seks knap-triggere fra flowet. Knapstyringen på Olivers værelse virker i forvejen ikke.
- **O - Light reset** kalder `AdaptiveLighting` med id `7768c895-…`, som ikke findes. Det burde formentlig være O Loft (`1e87af68-…`), så reset på Olivers værelse rammer ingenting i dag. Bekræftet direkte i Homey.
- **evedevicemonitor.js** overvåger to id'er, der ikke findes længere (`fd3cbe60-…`, `39450196-…`). O Eve Door & Window er kommenteret ud.
- **SV - Window open / SV - Window closed** (begge slået fra) trigges af en slettet enhed (`6f837c30-…`).
- **5 flows er slået fra:** SV - Window open, SV - Window closed, Heating switched off, ST - xHeating flow, SV - xHeating flow.
- **E7 - Inactive 1** trigges af zonen **Entre 9** og slukker lyset i **Entre 7** om natten. Måske bevidst, men navnet antyder Entre 7.
- **Dyson** (soveværelse) er utilgængelig i Homey.

## Enhed → brug

Kun enheder, der bruges i et flow, et script eller dashboardet. Flows medregner både kort og HomeyScript-argumenter.

| Enhed | Driver | Flows | Scripts |
|---|---|---|---|
| A Eve Weather | Eve-app | – | EVE Device Monitor/evedevicemonitor.js |
| A Light Lyskæde | Twinkly | A - Sunrise, A - Sunset, A - Turn off, A - Turn on | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| B7 Lys | Homey-gruppe | B7 - Light flow | Adaptive Lighting/adaptivelighting.js, Adaptive Lighting/room_watchdog.js, homey-dashboard/lib/adaptiveLighting.js |
| B7 Motion | Hue | – | Adaptive Lighting/room_watchdog.js |
| B9 Eve Motion Bruser | Eve-app | – | Adaptive Lighting/room_watchdog.js, EVE Device Monitor/evedevicemonitor.js |
| B9 Lys | Homey-gruppe | B9 - Light flow | Adaptive Lighting/adaptivelighting.js, Adaptive Lighting/gradualfadeout.js, Adaptive Lighting/restoresavedsettings.js, Adaptive Lighting/room_watchdog.js, homey-dashboard/lib/adaptiveLighting.js |
| B9 Motion | Hue | – | Adaptive Lighting/room_watchdog.js |
| BILRESA dual button | IKEA | O - Light flow | – |
| C Light Svampelampe | Matter | – | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| C LightStrip | Hue | C - Light flow | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| C Loft | Homey-gruppe | C - Light flow | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| C Radiator 1 | Hue | – | homey-dashboard/lib/heating.js |
| C Radiator 2 | Hue | – | homey-dashboard/lib/heating.js |
| E7 Eve Motion | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| E7 Lys | Hue | – | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| E9 Garderobe | Hue | E9 - Light flow | Adaptive Lighting/adaptivelighting.js, Adaptive Lighting/room_watchdog.js, homey-dashboard/lib/adaptiveLighting.js |
| E9 Loft | Hue | E9 - Light flow | Adaptive Lighting/adaptivelighting.js, Adaptive Lighting/room_watchdog.js, homey-dashboard/lib/adaptiveLighting.js |
| E9 Motion | Hue | – | Adaptive Lighting/room_watchdog.js |
| K Bord | Homey-gruppe | K - Light flow, K - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| K Eve Motion | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| K Eve Motion Køkkendør | Eve-app | – | EVE Device Monitor/evedevicemonitor.js |
| K Fryser | Eve-app | – | EVE Device Monitor/evedevicemonitor.js |
| K Kaffemaskine | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| K Køleskab | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| K Loft | Homey-gruppe | K - Light flow, K - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| K Network | Eve-app | – | EVE Device Monitor/evedevicemonitor.js |
| K Støvsuger | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| O Eve Door & Window | Eve-app | – | EVE Device Monitor/evedevicemonitor.js (udkommenteret) |
| O Eve Motion | Eve-app | – | EVE Device Monitor/evedevicemonitor.js |
| O Loft | Hue | O - Light flow | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| O Smart Thermostat | tado | Heating Master Off (Advanced), Heating switched off, O - Heating | – |
| Skovgaard | tado | C - Heating, O - Heating, ST - Heating, SV - Heating | Room Heating/room_heating.js, Room Heating/room_heating_config.js, Room Heating/room_heating_status.js |
| Skovgaard / Oliver | tado | O - Heating | homey-dashboard/lib/heating.js |
| Skovgaard / Soveværelse | tado | SV - xHeating flow | homey-dashboard/lib/heating.js |
| Skovgaard / Stue | tado | ST - xHeating flow | homey-dashboard/lib/heating.js |
| SS Bordlampe | Hue | SS - Light flow, SS - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| SS Light Perler | Twinkly | SS - Light flow, SS - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| SS Loft | Hue | SS - Light flow, SS - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| ST Light Lyskæde | Matter | – | EVE Device Monitor/evedevicemonitor.js |
| ST Loft | Homey-gruppe | ST - Light flow, ST - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| ST Motion | Hue | ST - Light flow | Adaptive Lighting/adaptivelighting.js |
| ST Smart Thermostat | tado | Heating Master Off (Advanced), Heating switched off, ST - Heating, ST - xHeating flow | – |
| ST Standerlampe | Homey-gruppe | ST - Light flow, ST - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js |
| SV Computer | Eve-app | SV - Computer, SV - Sluk Computer | EVE Device Monitor/evedevicemonitor.js |
| SV Loft | Homey-gruppe | SV - Light flow, SV - Light reset | Adaptive Lighting/adaptivelighting.js, homey-dashboard/lib/adaptiveLighting.js (test_fade_single.js er slettet 2026-10-28) |
| SV Motion | Hue | SV - Light flow | Adaptive Lighting/adaptivelighting.js |
| SV Smart Thermostat | tado | Heating Master Off (Advanced), Heating switched off, SV - Heating, SV - Window closed, SV - Window open, SV - xHeating flow | – |

## Zoneaktivitet for sensorer

Zone-triggere i flows afhænger af disse indstillinger. Sæt dem ens, hvis en sensor parres om.

| Sensor | Tæller med i zoneaktivitet |
|---|---|
| B7 Motion | til |
| B9 Motion | til |
| B9 Eve Motion Bruser | til |
| C Motion | til |
| E7 Eve Motion | til |
| E9 Motion | til |
| E9 Dør | til |
| K Eve Motion | til |
| K Eve Motion Køkkendør | til |
| O Eve Motion | til |
| ST Motion | til |
| SV Motion | til |
| C Vindue | fra |
| O Eve Door & Window | fra |
| SS Dør | fra |
| SS Vindue | fra |
| ST Vindue | fra |
| SV Vindue | fra |

## Flows

### Standard flows

| Flow | Aktiv | Triggere | Enheder | HomeyScript |
|---|---|---|---|---|
| A - Sunrise | ja | cron: sunrise | A Light Lyskæde | – |
| A - Sunset | ja | cron: sunset | A Light Lyskæde | – |
| A - Turn off | ja | cron: time_exactly | A Light Lyskæde | – |
| A - Turn on | ja | cron: sunrise | A Light Lyskæde | – |
| C - Heating Boost | ja | flow: programmatic_trigger | – | Room Heating(Clara,boost) |
| C - Heating Pause | ja | flow: programmatic_trigger | – | Room Heating(Clara,pause) |
| C - Heating Reset | ja | flow: programmatic_trigger | – | Room Heating(Clara,cancel) |
| E7 - Inactive 1 | ja | zone Entre 9: inactive_for | – | – |
| E7 - Inactive 5 | ja | zone Entre 7: inactive_for | – | – |
| Heating switched off | **nej** | logic: variable_changed | O Smart Thermostat, ST Smart Thermostat, SV Smart Thermostat | – |
| O - Heating Boost | ja | flow: programmatic_trigger | – | Room Heating(Oliver,boost) |
| O - Heating Pause | ja | flow: programmatic_trigger | – | Room Heating(Oliver,pause) |
| O - Heating Reset | ja | flow: programmatic_trigger | – | Room Heating(Oliver,cancel) |
| ST - Heating Boost | ja | flow: programmatic_trigger | – | Room Heating(Stue,boost) |
| ST - Heating Pause | ja | flow: programmatic_trigger | – | Room Heating(Stue,pause) |
| ST - Heating Reset | ja | flow: programmatic_trigger | – | Room Heating(Stue,cancel) |
| SV - Heating Boost | ja | flow: programmatic_trigger | – | Room Heating(Soveværelse,boost) |
| SV - Heating Pause | ja | flow: programmatic_trigger | – | Room Heating(Soveværelse,pause) |
| SV - Heating Reset | ja | flow: programmatic_trigger | – | Room Heating(Soveværelse,cancel) |
| SV - Sluk Computer | ja | cron: time_exactly | SV Computer | – |
| SV - Window closed | **nej** | ⚠ slettet enhed 6f837c30: alarm_contact_false_duration | SV Smart Thermostat | – |
| SV - Window open | **nej** | ⚠ slettet enhed 6f837c30: alarm_contact_true_duration | SV Smart Thermostat | – |

### Advanced flows

| Flow | Aktiv | Triggere | Enheder | HomeyScript |
|---|---|---|---|---|
| B7 - Light flow | ja | cron: time_exactly<br>zone Badeværelse 7: active<br>zone Badeværelse 7: inactive<br>nl.bevlogenheid.countdown: countdown_to_zero<br>B7 Lys: onoff_true<br>cron: every_nth | B7 Lys | GradualFadeOut(«B7 Lys»)<br>AdaptiveLighting(«B7 Lys»)<br>Room_watchdog(B7) |
| B9 - Light flow | ja | cron: time_exactly<br>nl.bevlogenheid.countdown: countdown_to_zero<br>zone Badeværelse 9: inactive<br>zone Badeværelse 9: active<br>B9 Lys: onoff_true<br>cron: every_nth | B9 Lys | GradualFadeOut(«B9 Lys»)<br>RestoreSavedSettings(«B9 Lys»)<br>AdaptiveLighting(«B9 Lys»)<br>Room_watchdog(B9) |
| C - Heating | ja | cron: every_nth<br>zone Claras værelse: active<br>zone Claras værelse: inactive_for<br>zone Claras værelse: alarm_true<br>Skovgaard: tado_presence_mode_changed<br>zone Claras værelse: alarm_false<br>nl.bevlogenheid.countdown: countdown_to_zero | Skovgaard | Room Heating(Clara) |
| C - Light flow | ja | C Loft: onoff_true<br>zone Claras værelse: inactive_for<br>C LightStrip: onoff_true | C LightStrip, C Loft | AdaptiveLighting(«C Loft»)<br>AdaptiveLighting(«C LightStrip») |
| E9 - Light flow | ja | cron: time_exactly<br>zone Entre 9: active<br>nl.bevlogenheid.countdown: countdown_to_zero<br>zone Entre 9: inactive<br>E9 Garderobe: onoff_true<br>E9 Loft: onoff_true<br>cron: every_nth | E9 Garderobe, E9 Loft | AdaptiveLighting(«E9 Garderobe»)<br>AdaptiveLighting(«E9 Loft»)<br>GradualFadeOut(«E9 Garderobe»,«E9 Loft»)<br>RestoreSavedSettings(«E9 Garderobe»)<br>RestoreSavedSettings(«E9 Loft»)<br>Room_watchdog(E9) |
| Eve Error Handler (HomeyScript) | ja | cron: every_nth<br>logic: variable_changed | – | EveDeviceMonitor() |
| Heating Master Off (Advanced) | ja | logic: variable_changed<br>cron: every_nth | O Smart Thermostat, ST Smart Thermostat, SV Smart Thermostat | – |
| K - Light flow | ja | K Bord: onoff_true<br>K Loft: onoff_true<br>cron: every_nth<br>zone Køkken: inactive_for | K Bord, K Loft | AdaptiveLighting(«K Bord»)<br>AdaptiveLighting(«K Loft»)<br>AdaptiveLighting(«K Bord» check)<br>AdaptiveLighting(«K Loft» check) |
| K - Light reset | ja | start/kaldes af andet flow | K Bord, K Loft | AdaptiveLighting(«K Bord» clear)<br>AdaptiveLighting(«K Loft» clear) |
| O - Heating | ja | cron: every_nth<br>zone Olivers værelse: active<br>zone Olivers værelse: inactive_for<br>zone Olivers værelse: alarm_true<br>Skovgaard: tado_presence_mode_changed<br>O Smart Thermostat: target_temperature_changed<br>Skovgaard / Oliver: target_temperature_changed<br>zone Olivers værelse: alarm_false<br>nl.bevlogenheid.countdown: countdown_to_zero | O Smart Thermostat, Skovgaard, Skovgaard / Oliver | Room Heating(Oliver) |
| O - Light flow | ja | O Loft: onoff_true<br>cron: every_nth<br>zone Olivers værelse: inactive_for<br>BILRESA dual button: switch_press_multi<br>BILRESA dual button: switch_long_press_multi<br>BILRESA dual button: switch_multi_press_multi | BILRESA dual button, O Loft | AdaptiveLighting(«O Loft»)<br>AdaptiveLighting(«O Loft» check)<br>AdaptiveLighting(«O Loft» brighten)<br>AdaptiveLighting(«O Loft» max)<br>AdaptiveLighting(«O Loft» cycle-profile)<br>AdaptiveLighting(«O Loft» dim-down)<br>AdaptiveLighting(«O Loft» toggle)<br>AdaptiveLighting(«O Loft» clear) |
| O - Light reset | ja | start/kaldes af andet flow | – | AdaptiveLighting(«⚠ ukendt 7768c895» clear) |
| SS - Light flow | ja | SS Loft: onoff_true<br>SS Bordlampe: onoff_true<br>SS Light Perler: onoff_true<br>cron: every_nth | SS Bordlampe, SS Light Perler, SS Loft | AdaptiveLighting(«SS Loft»)<br>AdaptiveLighting(«SS Bordlampe»)<br>AdaptiveLighting(«SS Light Perler»)<br>AdaptiveLighting(«SS Loft» check)<br>AdaptiveLighting(«SS Bordlampe» check)<br>AdaptiveLighting(«SS Light Perler» check) |
| SS - Light reset | ja | start/kaldes af andet flow | SS Bordlampe, SS Light Perler, SS Loft | AdaptiveLighting(«SS Loft» clear)<br>AdaptiveLighting(«SS Bordlampe» clear)<br>AdaptiveLighting(«SS Light Perler» clear) |
| ST - Heating | ja | cron: every_nth<br>zone Stue / Spisestue: active<br>zone Stue / Spisestue: inactive_for<br>zone Stue / Spisestue: alarm_true<br>Skovgaard: tado_presence_mode_changed<br>ST Smart Thermostat: target_temperature_changed<br>zone Stue / Spisestue: alarm_false<br>nl.bevlogenheid.countdown: countdown_to_zero | ST Smart Thermostat, Skovgaard | Room Heating(Stue) |
| ST - Light flow | ja | ST Loft: onoff_true<br>ST Standerlampe: onoff_true<br>cron: every_nth<br>zone Stue: inactive_for<br>ST Motion: measure_luminance_changed | ST Loft, ST Motion, ST Standerlampe | AdaptiveLighting(«ST Loft»)<br>AdaptiveLighting(«ST Standerlampe»)<br>AdaptiveLighting(«ST Loft» check)<br>AdaptiveLighting(«ST Standerlampe» check)<br>AdaptiveLighting(«ST Loft» lux [[homey:device:«ST Motion»|measure_luminance]])<br>AdaptiveLighting(«ST Standerlampe» lux [[homey:device:«ST Motion»|measure_luminance]]) |
| ST - Light reset | ja | start/kaldes af andet flow | ST Loft, ST Standerlampe | AdaptiveLighting(«ST Loft» clear)<br>AdaptiveLighting(«ST Standerlampe» clear) |
| ST - MediaCenter flow | ja | zone Stue: active<br>cron: time_exactly<br>nl.bevlogenheid.countdown: countdown_to_zero<br>zone Stue: inactive | – | – |
| ST - xHeating flow | **nej** | ST Smart Thermostat: measure_temperature_threshold_above<br>nl.bevlogenheid.countdown: countdown_to_zero<br>zone Stue / Spisestue: alarm_false<br>zone Stue / Spisestue: alarm_true<br>cron: every_nth<br>Skovgaard / Stue: target_temperature_changed | ST Smart Thermostat, Skovgaard / Stue | – |
| SV - Computer | ja | zone Soveværelse: active | SV Computer | – |
| SV - Heating | ja | cron: every_nth<br>zone Soveværelse: active<br>zone Soveværelse: inactive_for<br>zone Soveværelse: alarm_true<br>Skovgaard: tado_presence_mode_changed<br>zone Soveværelse: alarm_false<br>SV Smart Thermostat: target_temperature_changed<br>nl.bevlogenheid.countdown: countdown_to_zero | SV Smart Thermostat, Skovgaard | Room Heating(Soveværelse) |
| SV - Light flow | ja | SV Loft: onoff_true<br>cron: every_nth<br>zone Soveværelse: inactive_for<br>SV Motion: measure_luminance_changed | SV Loft, SV Motion | AdaptiveLighting(«SV Loft»)<br>AdaptiveLighting(«SV Loft» check)<br>AdaptiveLighting(«SV Loft» lux [[homey:device:«SV Motion»|measure_luminance]]) |
| SV - Light reset | ja | start/kaldes af andet flow | SV Loft | AdaptiveLighting(«SV Loft» clear) |
| SV - xHeating flow | **nej** | nl.bevlogenheid.countdown: countdown_to_zero<br>cron: every_nth<br>Skovgaard / Soveværelse: target_temperature_changed<br>zone Soveværelse: alarm_true<br>zone Soveværelse: alarm_false | SV Smart Thermostat, Skovgaard / Soveværelse | – |

## Enheder efter type

**Hue (Zigbee via Hue Bridge)** (57): B7 1, B7 2, B7 3, B7 Motion, B7 Switch, B9 Motion, B9 Switch, B9 Wall 1, B9 Wall 2, B9 Wall 3, C LightStrip, C Loft 1, C Loft 2, C Motion, C Radiator 1, C Radiator 2, C Switch, C Vindue, E7 Lys, E7 Switch, E9 Dør, E9 Garderobe, E9 Loft, E9 Motion, E9 Switch, K Bord 1, K Bord 2, K Bord 3, K Loft 1, K Loft 2, K Loft 3, K Switch, O Loft, O PS5, O Switch, SS Bordlampe, SS Dør, SS Loft, SS Switch, SS Vindue, ST Loft 1, ST Loft 2, ST Loft 3, ST Loft 4, ST Loft 5, ST Motion, ST Standerlampe 1, ST Standerlampe 2, ST Switch, ST TV, ST Vindue, SV Loft 1, SV Loft 2, SV Loft 3, SV Motion, SV Switch, SV Vindue

**Homey-grupper** (8): B7 Lys, B9 Lys, C Loft, K Bord, K Loft, ST Loft, ST Standerlampe, SV Loft

**Matter over Thread** (17): A Eve Weather, B9 Eve Motion Bruser, BILRESA dual button ⚠ utilgængelig, E7 Eve Motion, K Eve Motion, K Eve Motion Køkkendør, K Fryser, K Kaffemaskine, K Køleskab, K Network, K Støvsuger, KLIPPBOK water leak sensor ⚠ utilgængelig, O Eve Door & Window, O Eve Motion, ST Light Lyskæde, SV Computer, TIMMERFLOTTE temp/hmd sensor ⚠ utilgængelig

**Matter over Wi-Fi** (2): C Light Svampelampe, K Dreame X50

**tado** (7): O Smart Thermostat, Skovgaard, Skovgaard / Oliver, Skovgaard / Soveværelse, Skovgaard / Stue, ST Smart Thermostat, SV Smart Thermostat

**Andet** (7): A Light Lyskæde, C Roller Shade Driver E1, Dyson ⚠ utilgængelig, E7 Homey Pro, SS Light Perler, ST Roller Shade Driver E1, WWB380 Washing machine

## Ændret efter snapshot

- 2026-10-10: **O - Light reset**: argumentet til AdaptiveLighting er rettet fra det ikke-eksisterende id `7768c895-c037-4b83-84d4-9ef82404fe12` til O Loft `1e87af68-506e-4c86-8bc9-ffc6a05f3ef0` (`… clear`). Godkendt af HS.
- 2026-10-10: **E7 - Inactive 1**: trigger flyttet fra zonen Entre 9 til **Entre 7** (inaktiv 1 min, 20:00–06:00, B7 ikke aktiv → sluk lys i Entre 7). Godkendt af HS.
- 2026-10-10: **O - Light flow**: de 6 BILRESA-knap-triggere er fjernet (knap 1/2: tryk, langt tryk og dobbelttryk). De 6 AdaptiveLighting-handlinger, de var forbundet til (brighten, max, cycle-profile, dim-down, toggle, clear), er bevaret uden forbindelse, så de kan kobles til en ny knap. Godkendt af HS.
- 2026-10-27: **B7 - Light flow**: RestoreSavedSettings(«B7 Lys» `1ab9ca1f-60ca-44f9-8221-a03e10f005bf`) tilføjet på zonen Badeværelse 7 *active*, parallelt med pause-timeren og «tænd lys», som i B9. Uden kortet blev lyset stående på 0 %, hvis man bevægede sig under fade (GradualFadeOut FADE-HOLD venter på en restore). Note-kortet er opdateret, og AL- og watchdog-kortene er rykket lidt ned for at give plads. Godkendt af HS.
- 2026-10-27: **C - Light flow**: 5-minutters check-poll tilføjet som i O/K/SS: cron hvert 5. minut → «C Loft er tændt» → AdaptiveLighting(`9b15cb64-bf61-494d-be49-f3dcd9dfd0bf check`) og «C LightStrip er tændt» → AdaptiveLighting(`5acaab17-7864-4831-b6e2-72bd35588b21 check`). Før fik lysene kun en profil ved tænd. Hører sammen med adaptivelighting.js 2.27.2 (C LightStrip får weekendprofiler). Godkendt af HS.
- 2026-10-27: **E9 - Light flow**: weekend-kortet, der sætter E9_InactivitySeconds = 180, kører nu kl. **07:30** i stedet for 08:00, så det passer med AL's weekend-Morning (07:30 siden 2.19.1). Før lyste entréen med Morning-lys, men slukkede efter 30 s mellem 07:30 og 08:00. Godkendt af HS.
- 2026-10-27: **B9 - Light flow**: weekend-kortet (B9_InactivitySeconds = 120) kører nu kl. **07:30** i stedet for 08:00, af samme grund som E9 (før 60 s timeout mellem 07:30 og 08:00). Samtidig har syv kort fået UUID-id'er i stedet for håndskrevne (`restore-saved-settings-1`, `gradual-fade-script` og fem noter), fordi Homey MCP kun accepterer UUID-id'er. Ledninger, placering og opførsel er uændrede. Godkendt af HS.
- 2026-10-27: **B7, B9 og E9 - Light flow**: watchdog-kortet (Room_watchdog «B7»/«B9»/«E9», hvert minut) har fået betingelsen «Ikke alle Lys er slukket» (zone `all_off` med class light, inverteret) foran sig, så scriptet kun kører, når mindst ét lys i zonen er tændt. Før kørte det ~4.300 gange i døgnet. Watchdog-kortet er rykket til x=860. Hører sammen med room_watchdog.js 2.12 (WATCHDOG-ERROR i AL_DiagnostikLog). Godkendt af HS.
