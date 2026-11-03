// Cleanup Stale Adaptive Lighting Globals
//
// One-off script. Removes HomeyScript global variables that the Adaptive
// Lighting scripts no longer read or write. Safe to run more than once.
//
// It starts with DRY_RUN = true: it only lists what it would remove. Check the
// list, set DRY_RUN = false and run it again (several times if it says so).
// Run it after AdaptiveLighting 2.29.1, GradualFadeOut 6.14, RestoreSavedSettings
// 4.4 and Room_watchdog 2.13 are on the Homey — older versions write the flags again.
//
// What it removes — Adaptive Lighting keys only:
//   - <device id>_FadeActive          legacy fade flag, not written since GradualFadeOut 5.0
//   - <device id>_ManualRestoreUntil  not read since AdaptiveLighting 2.17.0
//   - <device id>_SavedManualMode     not written since GradualFadeOut 6.14 / Room_watchdog 2.13
//   - AL_DeviceStates, AL_ManualModes, AL_Fade_<key>,
//     OliverRoom_ForcedProfile, ClaraRoom_ForcedProfile
//                                     storage replaced by AL_Device_<key>.State in 2.18.0
//   - AL_Device_<key>.State           for devices that no longer exist on this Homey
// Then it rebuilds the AL_DeviceKeys index from the AL_Device_*.State keys left.
//
// What it keeps: every other key — Adaptive Lighting's current keys for devices
// that exist, Room Heating's, and any other script's.
//
// HomeyScript has no documented delete for globals: each key is set to
// undefined, then global.keys() is re-read to report which keys really went
// (one that is only emptied is harmless clutter). HomeyScript stops a run after
// a limited number of global writes, so at most BATCH_SIZE keys go per run.
//
// Script Name: AL_CleanupGlobals
// Version:     1.0
// Author:      Henrik Skovgaard
//
// Version history: CHANGELOG.md

const DRY_RUN = true;
const BATCH_SIZE = 14;   // + 1 write for the rebuilt index = 15, as Room Heating's cleanup

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DEAD_FLAG = new RegExp(`^${UUID}_(FadeActive|ManualRestoreUntil|SavedManualMode)$`);
const LEGACY_KEYS = ['AL_DeviceStates', 'AL_ManualModes', 'OliverRoom_ForcedProfile', 'ClaraRoom_ForcedProfile'];
const LEGACY_FADE = /^AL_Fade_[0-9a-f]{8}$/;
const DEVICE_STATE = /^AL_Device_([0-9a-f]{8})\.State$/;
const INDEX_KEY = 'AL_DeviceKeys';

// Devices that exist now. An empty list means the API call failed, not that
// every device is gone — never treat that as "remove all states"
const devices = Object.values(await Homey.devices.getDevices() || {});
if (devices.length === 0) {
  throw new Error('Homey returned no devices — not cleaning up (would look like every device was deleted)');
}
const existing = new Set(devices.map(d => d.id.substring(0, 8)));

function reason(key) {
  if (DEAD_FLAG.test(key)) return 'dead flag';
  if (LEGACY_KEYS.includes(key) || LEGACY_FADE.test(key)) return 'pre-2.18 storage';
  const m = DEVICE_STATE.exec(key);
  if (m && !existing.has(m[1])) return 'device no longer exists';
  return null;
}

// AL_DeviceKeys as it should be: the AL_Device_*.State keys that are left
function indexFrom(keys) {
  return keys.map(k => DEVICE_STATE.exec(k)).filter(Boolean).map(m => m[1])
    .filter(k => existing.has(k)).sort();
}
function currentIndex() {
  try { return JSON.parse(global.get(INDEX_KEY) || '[]'); } catch (e) { return []; }
}

// null is a real stored value (old RestoreSavedSettings left _SavedManualMode at
// null), so null keys are removed too. undefined means already gone/emptied.
// Keys holding a real value go first; a null key that stays listed after its
// removal doesn't count as "left" (HomeyScript may keep emptied keys listed)
const isGone = (k) => global.get(k) === undefined;
const hasValue = (k) => { const v = global.get(k); return v !== undefined && v !== null; };

const before = global.keys();
const matching = before.filter(k => reason(k) !== null);
const stale = matching.filter(k => !isGone(k))
  .sort((a, b) => (hasValue(b) - hasValue(a)) || a.localeCompare(b));
const alreadyEmpty = matching.filter(isGone);

log(`\n══ ADAPTIVE LIGHTING GLOBALS CLEANUP ${DRY_RUN ? '(DRY RUN)' : ''} ══`);
log(`Globals total: ${before.length}, stale: ${stale.length}, devices on Homey: ${devices.length}\n`);

if (stale.length > 0) {
  log('Stale keys:');
  for (const key of stale) log(`  - ${key}   (${reason(key)})`);
}
if (alreadyEmpty.length > 0) {
  log(`ℹ️  ${alreadyEmpty.length} more matching key(s) are already empty (nothing to remove)`);
}

const wantedIndex = indexFrom(before.filter(k => reason(k) === null));
const droppedFromIndex = currentIndex().filter(k => !wantedIndex.includes(k));
if (droppedFromIndex.length > 0) {
  log(`\n${INDEX_KEY}: ${droppedFromIndex.length} entr${droppedFromIndex.length === 1 ? 'y' : 'ies'} for missing devices: ${droppedFromIndex.join(', ')}`);
}

if (stale.length === 0 && droppedFromIndex.length === 0) {
  log('✅ Nothing to clean up');
  return { stale: 0 };
}

if (DRY_RUN) {
  log('\nDRY_RUN is on - nothing changed. Set DRY_RUN = false to remove them.');
  return { dryRun: true, stale: stale.length, indexDrops: droppedFromIndex.length };
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
const tried = new Set(batch);
const gone = batch.filter(k => !after.includes(k));
const emptied = batch.filter(k => after.includes(k) && !hasValue(k));
const unchanged = batch.filter(k => after.includes(k) && hasValue(k));
// Left: keys still holding a value, plus null keys this run didn't get to
const remaining = after.filter(k => reason(k) !== null
  && (hasValue(k) || (!tried.has(k) && global.get(k) === null))).length;

// Rebuild the index from what is left (one write)
const newIndex = indexFrom(after.filter(k => reason(k) === null));
if (JSON.stringify(newIndex) !== JSON.stringify(currentIndex())) {
  global.set(INDEX_KEY, JSON.stringify(newIndex));
  log(`\n${INDEX_KEY} rebuilt: ${newIndex.length} device(s)`);
}

log(`\n✅ Removed this run: ${gone.length}`);
if (emptied.length > 0) {
  log(`ℹ️  Still listed but empty (HomeyScript keeps the key): ${emptied.length}`);
}
if (unchanged.length > 0) {
  log(`⚠️  Still holding a value after removal: ${unchanged.length}`);
  for (const key of unchanged) log(`  - ${key} = ${JSON.stringify(global.get(key))}`);
}
if (remaining > 0) {
  log(`\n🔁 ${remaining} stale key(s) left - run this script again`);
} else {
  log('\n🎉 All stale Adaptive Lighting keys removed');
}
return { removed: gone.length, emptied: emptied.length, unchanged: unchanged.length, remaining };
