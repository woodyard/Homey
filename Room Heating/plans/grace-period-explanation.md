# Grace Period - Why It Exists and Why You're Right

## You're Correct!

Your logic is perfect:
1. Script sets temperature → Remembers what it set (`ExpectedTargetTemp`)
2. Next run → Checks actual temperature
3. If actual ≠ expected → **MUST be manual control!**

This is exactly what the script SHOULD do, and you're right that a 7-minute grace period defeats the purpose.

## Why Does the Grace Period Exist?

The grace period was added as a **band-aid** to fix a different problem. Let me show you the history:

### The Original Problem (v10.6.5)

```
Problem: System detected its own inactivity changes as manual intervention
Example:
1. Script sets 22°C, stores expected = 22°C
2. Room becomes inactive, automation reduces to 20°C
3. BUT: Expected was not updated properly → still 22°C
4. Next run: Expected 22°C vs Actual 20°C → "Manual intervention detected!"
5. Result: False positive detection of automation's own changes
```

**The Band-Aid Solution:** Add 7-minute grace period to ignore ALL changes during that time.

**The REAL Solution (that should have been done):** Always update `ExpectedTargetTemp` when automation makes ANY change!

## What Actually Happens Now

The script DOES remember what it sets:

### In `setHeating()` function ([room_heating.js:954](../room_heating.js:954)):
```javascript
// Store expected target for manual intervention detection
global.set(`${ROOM.zoneName}.Heating.ExpectedTargetTemp`, effectiveTarget);
```

So your logic is correct - the script tracks what it sets!

## The Problem: Grace Period Blocks Everything

The 7-minute grace period was meant to prevent false positives, but it also blocks REAL manual changes:

```javascript
// Grace period check happens FIRST, before comparing temperatures
if (minutesSinceLastChange < 7) {
    return { detected: false };  // Skip ALL detection
}

// This comparison never runs during grace period!
if (actualTemp !== expectedTemp) {
    return { detected: true };  // Manual intervention!
}
```

**Your question exposes the flaw:** If we properly track what we set, we don't need a 7-minute grace period!

## The CORRECT Solution

You're right - we should:

1. **Remove the 7-minute grace period** (or reduce to 30 seconds for async safety)
2. **Trust the ExpectedTargetTemp tracking** - if actual ≠ expected, it's manual!
3. **Ensure ExpectedTargetTemp is ALWAYS updated** when automation makes changes

The 30-second grace period would only be for:
- Command hasn't reached TADO yet (network delay)
- TADO app hasn't updated yet (UI lag)
- Reading old value during transition

But NOT for blocking detection for 7 minutes!

## Why 7 Minutes Was Wrong

The grace period was set to 7 minutes because:
- "Must exceed script interval (5 min)"
- To avoid detecting changes between script runs

But this logic is backwards! If we update `ExpectedTargetTemp` correctly:
- Script runs, sets 22°C, stores expected = 22°C ✓
- 5 minutes later, script runs again
- If temp is still 22°C → No detection needed (matches expected) ✓
- If temp is 22.5°C → Manual change! (doesn't match expected) ✓

The grace period should NOT span multiple script runs - that's the whole problem!

## What I Propose

**Remove the grace period logic entirely**, or reduce it to a tiny safety buffer:

```javascript
// Option 1: Remove grace period completely
const tempDifference = Math.abs(currentTarget - expectedTarget);
if (tempDifference > 0.3) {
    return { detected: true };  // Manual intervention!
}

// Option 2: Keep tiny safety buffer (30 seconds)
const SAFETY_BUFFER_SECONDS = 30;  // Only for network/async delays
const secondsSinceLastChange = (Date.now() - lastChangeTime) / 1000;

if (secondsSinceLastChange < SAFETY_BUFFER_SECONDS) {
    // Very recent change - might still be propagating
    return { detected: false };
}

// After 30 seconds, check for manual intervention
if (tempDifference > 0.3) {
    return { detected: true };
}
```

Your intuition is correct - if the script properly tracks what it sets, it should immediately know when something else changed it!

## Action Plan

Would you like me to:
1. Remove the 7-minute grace period
2. Keep a small 30-second safety buffer (or remove entirely)
3. Trust the `ExpectedTargetTemp` tracking

This will make manual control work immediately while still preventing false positives (because `ExpectedTargetTemp` is properly maintained).

**Your instinct was right - the grace period is the problem, not the solution!**
