/**
 * Cleanup Stale Room Heating Globals
 *
 * One-off script. Removes HomeyScript global variables that room_heating.js no longer
 * writes or reads (left over from versions before 10.23.0). Safe to run more than once.
 *
 * What it removes (per configured heating zone):
 *   - pre-10.16 individual state variables (BoostMode, PauseMode, ManualOverride*, Window*, ...)
 *   - 10.19 command queue state (Heating.Device.<id>.State, Heating.CurrentSession)
 *   - 10.22 display-only variables (Temperature, EffectiveTemperature, Heating.PeriodName, ...)
 *   - 10.23 Skoleintra cache (SchoolCalendar.Data, SchoolCalendar.CacheTime)
 *
 * What it keeps:
 *   - Config.*  <zone>.Heating.State  <zone>.Heating.RunLock  <zone>.Heating.DiagnostikLog
 *   - anything that is not a heating variable of a configured zone (other scripts' globals)
 *
 * HomeyScript has no documented delete for globals. This script sets each stale key to
 * undefined, then re-reads global.keys() and reports which keys really disappeared and
 * which only got emptied (an emptied key is harmless, just clutter).
 *
 * HomeyScript stops a run after a limited number of global writes, so the script removes
 * at most BATCH_SIZE keys per run and asks you to run it again until nothing is left.
 * Set DRY_RUN = true to only list what would be removed.
 *
 * Author: Henrik Skovgaard
 * Version: 1.1.0
 * Created: 2026-09-07
 *
 * Version history: CHANGELOG.md
 */

const DRY_RUN = false;
const BATCH_SIZE = 15;

// ---------------------------------------------------------------------------

const roomsJson = global.get('Config.Rooms');
if (!roomsJson) {
    throw new Error('Config.Rooms not found - run room_heating_config.js first');
}
const ROOMS = JSON.parse(roomsJson);
const ZONES = Object.values(ROOMS).map(r => r.zoneName);

const KEEP_SUFFIXES = ['.Heating.State', '.Heating.RunLock', '.Heating.DiagnostikLog'];

// Exact zone-level suffixes that older versions wrote
const STALE_SUFFIXES = [
    // display-only (removed in 10.22.0)
    '.Temperature', '.TemperatureLow', '.TemperatureHigh', '.EffectiveTemperature',
    '.Heating.InactivityOffset', '.Heating.SlotInactivityTimeout', '.Heating.SlotWindowOpenTimeout',
    '.Heating.SlotWindowClosedDelay', '.Heating.ScheduleType', '.Heating.CurrentPeriod',
    '.Heating.PeriodName', '.Heating.ActiveInactivityTimeout', '.Heating.ActiveInactivityOffset',
    '.Heating.LastUpdate', '.Heating.CurrentTemp', '.Heating.LastAction', '.Heating.LastEffectiveTarget',
    '.Heating.LastWindowOpen', '.Heating.LastLogTime',
    // command queue (removed in 10.19.0)
    '.Heating.CurrentSession',
    // individual state variables (replaced by .Heating.State in 10.16.0)
    '.Heating.ManualOverrideMode', '.Heating.ManualOverrideStartTime', '.Heating.ManualOverrideDuration',
    '.Heating.ManualOverrideType', '.Heating.ManualOverrideOriginalValue',
    '.Heating.BoostMode', '.Heating.BoostStartTime', '.Heating.BoostDuration',
    '.Heating.PauseMode', '.Heating.PauseStartTime', '.Heating.PauseDuration',
    '.Heating.TadoAwayActive', '.Heating.LastVerifiedOnOff', '.Heating.LastVerifiedTargetTemp',
    '.Heating.LastCommandedOnOff', '.Heating.LastAutomationChangeTime',
    '.Heating.WindowOpenTime', '.Heating.WindowClosedTime', '.Heating.WindowTimeoutHandled',
    '.Heating.InactivityMode', '.Heating.LastRunTemp',
    '.Heating.LastNotificationKey', '.Heating.LastNotificationTime',
    '.Heating.ExpectedTargetTemp', '.Heating.GracePeriodEnd'
];

const STALE_GLOBAL_KEYS = ['SchoolCalendar.Data', 'SchoolCalendar.CacheTime'];

function isStale(key) {
    if (STALE_GLOBAL_KEYS.includes(key)) return true;
    for (const zone of ZONES) {
        if (!key.startsWith(zone + '.')) continue;
        if (KEEP_SUFFIXES.some(s => key === zone + s)) return false;
        if (key.startsWith(zone + '.Heating.Device.') && key.endsWith('.State')) return true;
        if (STALE_SUFFIXES.some(s => key === zone + s)) return true;
    }
    return false;
}

const before = global.keys();
const stale = before.filter(isStale).sort();
const kept = before.filter(k => !isStale(k)).sort();

log(`\n══ ROOM HEATING GLOBALS CLEANUP ${DRY_RUN ? '(DRY RUN)' : ''} ══`);
log(`Zones: ${ZONES.join(', ')}`);
log(`Globals total: ${before.length}, stale: ${stale.length}, kept: ${kept.length}\n`);

if (stale.length === 0) {
    log('✅ Nothing to clean up');
    return;
}

log('Stale keys:');
for (const key of stale) log(`  - ${key}`);

if (DRY_RUN) {
    log('\nDRY_RUN is on - nothing changed. Set DRY_RUN = false to remove them.');
    return;
}

const batch = stale.slice(0, BATCH_SIZE);
log(`\nRemoving ${batch.length} of ${stale.length} this run:`);

for (const key of batch) {
    try {
        await global.set(key, undefined);
        log(`  ✓ ${key}`);
    } catch (error) {
        log(`  ⚠️ ${key}: ${error.message}`);
    }
    await wait(200);
}

const after = global.keys();
const gone = batch.filter(k => !after.includes(k));
const emptied = batch.filter(k => after.includes(k));
const remaining = stale.length - gone.length;

log(`\n✅ Removed this run: ${gone.length}`);
if (emptied.length > 0) {
    log(`ℹ️  Still listed but empty (HomeyScript keeps the key): ${emptied.length}`);
    for (const key of emptied) log(`  - ${key} = ${JSON.stringify(global.get(key))}`);
}
if (remaining > 0) {
    log(`\n🔁 ${remaining} stale key(s) left - run this script again`);
} else {
    log(`\n🎉 All stale keys removed`);
    log(`\nKept (${kept.length}):`);
    for (const key of kept) log(`  - ${key}`);
}
