# Boost Mode Activation Issue - Analysis

## Problem Description

When the user tries to enable boost mode, two notifications appear in this order:

1. **First notification**: `🚀 Boost activated • 60 min`
2. **Second notification**: `🤚 Manual override • 90 min • 🛑 Boost cancelled • Resumed schedule`

**Result**: Boost mode gets activated but then immediately cancelled, leaving the system in manual override mode instead of the intended boost mode.

## Root Cause Analysis

After analyzing the code in [`room_heating.js`](../room_heating.js), I've identified this is happening within a **single script execution**:

### Execution Flow When User Requests Boost

1. **User executes**: `await run('Stue', 'boost')`
2. `requestBoost = true` is set ([`room_heating.js:113`](../room_heating.js:113))

3. **Manual intervention detection is SKIPPED** ([`room_heating.js:1651`](../room_heating.js:1651)):
   ```javascript
   if (!requestCancel && !requestBoost && !requestPause) {
       // Manual detection - SKIPPED when boost requested
   }
   ```

4. **Boost mode is activated** ([`room_heating.js:1713-1726`](../room_heating.js:1713)):
   ```javascript
   if (requestBoost) {
       // Cancel any active pause/manual override
       if (pauseWasActive) { cancelPauseMode(); }
       if (manualWasActive) { cancelManualOverrideMode(); }
       activateBoostMode();  // Sets BoostMode = true
   }
   ```

5. **Boost control executes** ([`room_heating.js:1774-1809`](../room_heating.js:1774)):
   ```javascript
   if (boostStatus.active) {
       // Run boost heating control
       const action = await controlHeatingBoost();
       
       // TADO target set to 25°C
       await device.setCapabilityValue('target_temperature', BOOST_TEMPERATURE_TADO);
       
       // Send notification: "🚀 Boost activated • 60 min"
   }
   ```

6. **PROBLEM**: After boost notification is sent, **normal schedule code continues** 🐛
   - Script doesn't return/exit after boost notification
   - Normal schedule operation code at line 1890+ executes
   - Manual intervention detection runs again (not in the skip block!)

7. **Manual detection fires** because:
   - TADO target is now 25°C (from boost)
   - Expected target is still the schedule value (e.g., 22°C)
   - Difference > 0.3°C threshold
   - System thinks: "User manually changed temperature!"

8. **Manual override activated**, which cancels boost:
   ```javascript
   if (boostWasActive) {
       log(`\n🔄 Cancelling active boost due to manual intervention...`);
       cancelBoostMode();  // Adds "Boost cancelled" to notification
   }
   ```

9. **Second notification sent**: `🤚 Manual override • 90 min • 🛑 Boost cancelled • Resumed schedule`

## The Critical Bug

**The script should RETURN/EXIT after handling boost mode**, but it doesn't!

Looking at [`room_heating.js:1808-1809`](../room_heating.js:1808):
```javascript
log(`\n=== BOOST MODE - COMPLETED ===`);
return;  // ✅ This DOES return!
```

So the code DOES return... which means the manual detection must be happening **BEFORE** boost control runs.

### Wait... Let me re-analyze...

Actually, looking more carefully at the flow:

1. **Lines 1650-1677**: Manual intervention detection (SKIPPED when `requestBoost = true`)
2. **Lines 1713-1726**: Boost activation (`activateBoostMode()` called)
3. **Lines 1772-1809**: Boost control and notification, then RETURN

So manual detection CANNOT run after boost... unless...

### The Real Issue: `activateBoostMode()` vs `controlHeatingBoost()`

Let me trace what happens:

1. **`activateBoostMode()`** ([`room_heating.js:274-285`](../room_heating.js:274)):
   - Sets global flags
   - Adds notification changes
   - **Does NOT set heating or update `ExpectedTargetTemp`**

2. **`controlHeatingBoost()`** ([`room_heating.js:361-414`](../room_heating.js:361)):
   - Actually sets TADO to 25°C
   - **Does NOT update `ExpectedTargetTemp`**

3. **After boost control returns** (line 1809), script exits

So the issue must be happening in the **NEXT automatic script execution** (5 minutes later):

### Corrected Root Cause: Two Script Executions

#### First Execution (User's Boost Request)
1. User: `await run('Stue', 'boost')`
2. Boost activated, TADO set to 25°C
3. Notification: "🚀 Boost activated • 60 min"
4. Script exits
5. **`ExpectedTargetTemp` is still the schedule value (22°C)**

#### Second Execution (5 minutes later - Automatic)
1. Scheduled script runs automatically
2. `requestBoost = false` (no boost argument)
3. Grace period check: Has it been > 7 minutes? **Probably YES if user was idle**
4. Manual intervention detection runs
5. Compares: Expected 22°C vs Actual 25°C → Difference = 3°C > 0.3°C
6. **Detects as manual intervention!**
7. Activates manual override mode
8. Cancels active boost (because manual override has priority)
9. Notification: "🤚 Manual override • 90 min • 🛑 Boost cancelled • Resumed schedule"

**But wait** - if the two notifications appear immediately after each other in the user's report, they must be from the same execution...

### Let me look at the timestamp pattern again:

```
Jan 17 2026 19:57:02
```

Both notifications would have the same timestamp if from the same execution.

## The ACTUAL Problem

Looking at [`room_heating.js:361-414`](../room_heating.js:361) - `controlHeatingBoost()`:

```javascript
async function controlHeatingBoost() {
    log(`\n--- BOOST HEATING CONTROL ---`);
    log(`Boost mode: ACTIVE - overriding all normal logic`);
    
    if (ROOM.heating.type === 'tado_valve') {
        // ... set temperature to 25°C ...
        
        if (currentTarget !== BOOST_TEMPERATURE_TADO) {
            await device.setCapabilityValue('target_temperature', BOOST_TEMPERATURE_TADO);
            log(`🎯 TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C`);
        }
        
        // 🐛 BUG: Does NOT update ExpectedTargetTemp!
        return 'boost_tado';
    }
}
```

**The function sets the TADO temperature but does NOT update the expected value.**

Compare this to the normal `setHeating()` function ([`room_heating.js:926-988`](../room_heating.js:926)):

```javascript
// Store expected target for manual intervention detection
global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, effectiveTarget);
```

## Solutions

### Solution 1: Update ExpectedTargetTemp in controlHeatingBoost() ⭐ RECOMMENDED

**File**: [`room_heating.js:361-414`](../room_heating.js:361)

Add after setting the TADO temperature:

```javascript
if (currentTarget !== BOOST_TEMPERATURE_TADO) {
    await device.setCapabilityValue('target_temperature', BOOST_TEMPERATURE_TADO);
    log(`🎯 TADO boost temperature set to ${BOOST_TEMPERATURE_TADO}°C`);
    
    // 🔧 FIX: Update expected target to prevent false manual detection
    global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, BOOST_TEMPERATURE_TADO);
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    log(`📝 Expected target updated to ${BOOST_TEMPERATURE_TADO}°C (boost mode)`);
}
```

### Solution 2: Also Set Expected in activateBoostMode()

**File**: [`room_heating.js:274-285`](../room_heating.js:274)

```javascript
function activateBoostMode() {
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, true);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, Date.now());
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, BOOST_DURATION_MINUTES);
    
    // 🔧 FIX: Pre-set expected target for TADO rooms
    if (ROOM.heating.type === 'tado_valve') {
        global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, BOOST_TEMPERATURE_TADO);
    }
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    
    log(`\n🚀 BOOST MODE ACTIVATED`);
    log(`Duration: ${BOOST_DURATION_MINUTES} minutes`);
    log(`Room: ${roomArg} (${ROOM.zoneName})`);
    
    addChange(`🚀 Boost activated`);
    addChange(`${BOOST_DURATION_MINUTES} min`);
}
```

### Solution 3: Similar Fix for Boost Expiration

When boost expires, reset grace period to prevent immediate manual detection:

**File**: [`room_heating.js:343-356`](../room_heating.js:343)

```javascript
if (minutesElapsed >= boostDuration) {
    // Boost expired - clear it
    log(`\n⏱️ BOOST MODE EXPIRED`);
    log(`Duration: ${boostDuration} minutes elapsed`);
    
    global.set(`${ROOM.zoneName}.Heating.BoostMode`, false);
    global.set(`${ROOM.zoneName}.Heating.BoostStartTime`, null);
    global.set(`${ROOM.zoneName}.Heating.BoostDuration`, null);
    
    // 🔧 FIX: Reset grace period to prevent false manual detection
    global.set(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`, Date.now());
    log(`📝 Grace period reset after boost expiration`);
    
    addChange(`⏱️ Boost ended`);
    addChange(`Resumed schedule`);
    
    return { active: false, expired: true, remainingMinutes: 0 };
}
```

### Solution 4: Same Fixes for Pause Mode

Apply identical fixes to pause mode functions to prevent similar issues.

## Recommended Implementation

**Implement all three solutions**:

1. ✅ Update `ExpectedTargetTemp` in `controlHeatingBoost()` when setting temperature
2. ✅ Set `ExpectedTargetTemp` in `activateBoostMode()` (early protection)
3. ✅ Reset grace period when boost expires
4. ✅ Apply same fixes to pause mode

This ensures:
- No false manual detection while boost is active
- No false manual detection immediately after boost expires
- Proper tracking of automation-initiated temperature changes
- Consistent behavior across boost and pause modes

## Why This Happens Now

The manual intervention detection was added in version 10.6.0 (2026-01-13), but it didn't account for boost mode's temperature changes. Boost mode was added in 10.4.0 (2026-01-08), before manual detection existed.

The grace period mechanism exists but:
- It's only reset when `setHeating()` makes ACTUAL changes
- `controlHeatingBoost()` bypasses `setHeating()` for performance
- Result: Grace period isn't reset, allowing manual detection to fire

## Files to Modify

1. **[`room_heating.js`](../room_heating.js)** - Main fixes:
   - Line ~395: Add `ExpectedTargetTemp` update in `controlHeatingBoost()`
   - Line ~280: Add `ExpectedTargetTemp` in `activateBoostMode()`
   - Line ~350: Reset grace period in `checkBoostMode()` when expired
   - Line ~520: Add `ExpectedTargetTemp` update in `controlHeatingPause()`
   - Line ~425: Set expected in `activatePauseMode()`
   - Line ~480: Reset grace period in `checkPauseMode()` when expired

## Testing Checklist

After implementing fixes:

- [ ] Activate boost mode from normal schedule → Should show only "Boost activated"
- [ ] Wait for next automatic script run (5 min) → Should NOT detect manual intervention
- [ ] Let boost run for 10+ minutes → Manual detection should NOT fire
- [ ] Let boost expire → Should show only "Boost ended"
- [ ] Manually change temperature after boost ends → Should still detect after grace period
- [ ] Activate boost, manually change temp → Should detect and override boost
- [ ] Test same scenarios with pause mode

## Success Criteria

✅ Single notification when activating boost: "🚀 Boost activated • 60 min"  
✅ Boost remains active for full 60 minutes (unless manually cancelled)  
✅ No false "manual override" detection during boost  
✅ Manual intervention detection still works when user actually makes changes  
