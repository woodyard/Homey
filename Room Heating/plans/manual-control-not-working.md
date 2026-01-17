# Manual Control Not Working - Analysis

## Problem Description

When user manually sets Stue temperature to 22.5°C:
1. **System does nothing** - No manual override detection, no notification
2. **Next script run** - Temperature is reset back to 22.0°C (schedule value)
3. **Expected behavior** - Manual override should be detected, automation paused for 90 minutes

## Root Cause: Grace Period Too Long

The grace period of **7 minutes** is blocking legitimate manual detection.

### How Grace Period Works

From [`room_heating.js:634-642`](../room_heating.js:634):
```javascript
const MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES = 7; // Must exceed script interval (5 min)

const lastChangeTime = global.get(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`) || 0;
const minutesSinceLastChange = (Date.now() - lastChangeTime) / 1000 / 60;

if (minutesSinceLastChange < MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES) {
    return { detected: false };  // Skip detection during grace period
}
```

**Purpose**: Prevent detecting automation's own temperature changes as "manual intervention"

**Problem**: Also blocks detection of REAL user manual changes during that time

### Typical Scenario

1. **19:20** - Script runs, sets temp to 22°C from schedule
   - Grace period reset → Active until 19:27
2. **19:22** - User manually changes temp to 22.5°C
3. **19:25** - Script runs again (5 min interval)
   - Grace period check: 5 min < 7 min → **Skip detection!**
   - Normal heating control runs
   - Sets temp back to 22°C (schedule value)
   - **User's manual change overridden**
4. **19:30** - Script runs again
   - Grace period check: 10 min > 7 min → Detection would work
   - But temp is already back to 22°C (no difference to detect)

### Why 7 Minutes?

From CHANGELOG v10.6.5:
```
Increased grace period from 2 to 7 minutes for additional safety margin
Problem: Grace period constantly reset causing false positives
```

- Script runs every 5 minutes (scheduled)
- Script also runs on events (motion, window, etc.) - could be more frequent
- Grace period MUST exceed script interval to prevent false positives
- But 7 minutes is too long - blocks manual changes for ~2 script runs

## The Fundamental Problem

The grace period is **too broad** - it blocks ALL detection, not just false positives.

**We cannot differentiate between:**
1. Temperature changed by automation (should ignore during grace period)
2. Temperature changed by user (should detect even during grace period)

Both look the same: `Expected: 22°C, Actual: 22.5°C`

## Our Recent Boost Fixes Made It Worse

The fixes I just added reset the grace period MORE often:

1. **`activateBoostMode()`** - Resets grace period (before any actual change)
2. **`controlHeatingBoost()`** - Resets grace period (when setting temperature)
3. **`activatePauseMode()`** - Resets grace period (before any actual change)
4. **`controlHeatingPause()`** - Resets grace period (when turning off)
5. **Boost expiration** - Resets grace period (when boost ends)
6. **Pause expiration** - Resets grace period (when pause ends)

This means the grace period is almost always active, making manual detection rarely work.

## Solutions

### Option 1: Reduce Grace Period ⚠️ Risky

Reduce from 7 minutes to 2-3 minutes:
```javascript
const MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES = 2;
```

**Pros:**
- Shorter window where manual changes are blocked
- User changes detected faster

**Cons:**
- Might bring back false positive detections
- Doesn't solve fundamental problem

### Option 2: Smart Grace Period ⭐ RECOMMENDED

Only use grace period when values MATCH expected:
```javascript
const tempDifference = Math.abs(currentTarget - expectedTarget);

// If temp matches expected, we're good - no need to check for manual intervention
if (tempDifference <= 0.3) {
    return { detected: false };
}

// Temp differs - check if within grace period
const lastChangeTime = global.get(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`) || 0;
const minutesSinceLastChange = (Date.now() - lastChangeTime) / 1000 / 60;

if (minutesSinceLastChange < MANUAL_OVERRIDE_GRACE_PERIOD_MINUTES) {
    // Within grace period but temp differs - could be automation in progress
    // Only skip if difference is small (automation rounding)
    if (tempDifference < 0.5) {
        return { detected: false };  // Probably automation rounding
    }
}

// Large difference OR outside grace period → Manual intervention!
return { detected: true, ... };
```

**Logic:**
- If actual = expected: No intervention, skip detection (fast path)
- If actual ≠ expected + within grace: Only skip if small diff (< 0.5°C)
- If actual ≠ expected + outside grace: Detect as manual intervention
- If actual differs significantly: Detect even during grace period

**Pros:**
- Allows detecting large manual changes (22→22.5°C = 0.5°C) immediately
- Still protects against automation's own changes
- More intelligent, less blocking

**Cons:**
- More complex logic
- Need to tune threshold (0.5°C seems right)

### Option 3: Remove Grace Period from Boost/Pause Activation

Don't reset grace period in `activateBoostMode()` and `activatePauseMode()`:
```javascript
function activateBoostMode() {
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, true);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, BOOST_DURATION_MINUTES);
    
    // Set expected target but DON'T reset grace period yet
    // Let controlHeatingBoost() reset it when actually making the change
    if (ROOM.heating.type === 'tado_valve') {
        global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, BOOST_TEMPERATURE_TADO);
    }
    // REMOVED: global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    
    log(`\n🚀 BOOST MODE ACTIVATED`);
    ...
}
```

**Pros:**
- Reduces frequency of grace period resets
- Only reset when ACTUALLY changing temperature

**Cons:**
- Doesn't fully solve the problem
- Still have 7-minute windows after actual changes

## Recommended Approach

**Combine Option 2 + Option 3:**

1. **Remove grace period reset from activation functions** (Option 3)
   - Don't reset in `activateBoostMode()` and `activatePauseMode()`
   - Only reset in control functions when actually making changes

2. **Make grace period smarter** (Option 2)
   - If actual matches expected: Skip detection (no intervention)
   - If actual differs significantly (> 0.5°C): Detect even during grace period
   - If actual differs slightly + within grace: Skip (probably automation)

This gives us:
- ✅ Immediate detection of user manual changes (22→22.5°C detected right away)
- ✅ Protection against false positives from automation changes
- ✅ Less frequent grace period resets
- ✅ More intelligent detection logic

## Implementation Steps

1. Modify [`detectManualIntervention()`](../room_heating.js:633) to use smart grace period
2. Remove grace period reset from [`activateBoostMode()`](../room_heating.js:274)
3. Remove grace period reset from [`activatePauseMode()`](../room_heating.js:420)
4. Keep grace period reset in actual control functions (they make real changes)
5. Update tests and documentation

## Testing

After fixes:
- [ ] Manually set temp to 22.5°C → Should detect immediately, activate manual override
- [ ] Manual override active for 90 minutes → System respects user's setting
- [ ] After 90 min → System reverts to schedule
- [ ] Activate boost → Should NOT trigger false manual detection
- [ ] Let boost expire → Should NOT trigger false manual detection
- [ ] Open window → Should NOT trigger false manual detection
