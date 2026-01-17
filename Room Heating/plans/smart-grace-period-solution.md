# Smart Grace Period Solution

## The Problem You Identified

Script can run very frequently due to events:
- **Motion sensor** → Script runs
- **Window open/close** → Script runs  
- **Temperature change** → Script runs
- **Manual trigger** → Script runs
- **Schedule** → Script runs every 5 min

**Scenario:**
1. Script sets temp to 22°C (resets grace period)
2. User changes to 22.5°C manually
3. Motion event → Script runs 2 seconds later
4. Grace period check: 2s < 30s → **Skip detection**
5. User's change overridden 😞

## The Current Logic (Too Simple)

```javascript
// If within grace period, skip ALL detection
if (minutesSinceLastChange < 0.5) {
    return { detected: false };
}

// Check for manual intervention
if (tempDifference > 0.3) {
    return { detected: true };
}
```

This blocks everything for 30 seconds, regardless of how different the temperature is.

## The Smart Solution

**Key insight:** The grace period should only protect against reading OUR OWN changes too quickly, not block detecting DIFFERENT values.

```javascript
async function detectManualIntervention() {
    // ... existing setup code ...
    
    const expectedTarget = global.get(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`);
    
    if (expectedTarget === null || expectedTarget === undefined) {
        return { detected: false };
    }
    
    const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
    const currentTarget = device.capabilitiesObj.target_temperature.value;
    const tempDifference = Math.abs(currentTarget - expectedTarget);
    
    // FAST PATH: If temp matches expected, no intervention
    if (tempDifference <= 0.3) {
        return { detected: false };
    }
    
    // Temperature differs from expected - check grace period intelligently
    const lastChangeTime = global.get(`${ROOM.zoneName}.Heating.LastAutomationChangeTime`) || 0;
    const secondsSinceLastChange = (Date.now() - lastChangeTime) / 1000;
    
    // Within grace period but temp differs - analyze the difference
    if (secondsSinceLastChange < 30) {
        // Small difference during grace period = probably automation propagating
        // Large difference = definitely manual (even during grace period)
        if (tempDifference < 0.5) {
            log(`⏳ Grace period: ${secondsSinceLastChange}s elapsed, diff ${tempDifference.toFixed(1)}°C (< 0.5°C) - skipping (probably automation lag)`);
            return { detected: false };
        } else {
            log(`🎯 Grace period: ${secondsSinceLastChange}s elapsed, BUT diff ${tempDifference.toFixed(1)}°C (≥ 0.5°C) - detecting as MANUAL!`);
            // Fall through to detection below
        }
    }
    
    // Detect as manual intervention
    log(`\n🤚 MANUAL INTERVENTION DETECTED (TADO)`);
    log(`Expected: ${expectedTarget}°C, Found: ${currentTarget}°C`);
    log(`Difference: ${tempDifference.toFixed(1)}°C`);
    
    return {
        detected: true,
        type: 'temperature',
        originalValue: expectedTarget,
        currentValue: currentTarget
    };
}
```

## How It Works

### Scenario 1: Automation Just Made Change (2 seconds ago)
- Expected: 22°C, Actual: 22°C → Match → No detection ✓

### Scenario 2: Automation Made Change, Still Propagating (2 seconds ago)
- Expected: 22°C, Actual: 21.8°C (device lag)
- Diff: 0.2°C < 0.5°C → Skip (grace period protection) ✓

### Scenario 3: User Manual Change (2 seconds after automation)
- Expected: 22°C, Actual: 22.5°C (user changed it)
- Diff: 0.5°C ≥ 0.5°C → **Detect immediately!** ✓
- Even though only 2 seconds passed

### Scenario 4: User Manual Change (35 seconds after automation)
- Expected: 22°C, Actual: 22.3°C (user changed it)
- Diff: 0.3°C, but > 30s passed → Detect as manual ✓

## Benefits

✅ Protects against automation lag (small differences during grace period)  
✅ Detects large manual changes immediately (even within 30 seconds)  
✅ Works with rapid script execution (motion events, etc.)  
✅ No false positives from automation's own changes  
✅ User manual control works as expected  

## Thresholds

- **Match threshold**: 0.3°C (TADO rounding tolerance)
- **Grace period**: 30 seconds (network/device lag)
- **Immediate detection threshold**: 0.5°C (clearly manual change)

**Logic:**
- `≤ 0.3°C` = No intervention (matches expected)
- `0.3-0.5°C` during grace = Probably automation lag, skip
- `≥ 0.5°C` = Manual intervention (detect immediately, even during grace)
- Any difference after 30s = Manual intervention

## Implementation

Would you like me to implement this smart grace period logic?
