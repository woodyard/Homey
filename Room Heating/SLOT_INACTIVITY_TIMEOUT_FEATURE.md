# Per-Slot Inactivity Timeout Feature

**Version:** 1.0.4 (Config) / 10.7.0 (Heating) / 4.7.0 (Status)  
**Date:** 2026-01-17  
**Author:** Henrik Skovgaard

## Overview

The heating system now supports configuring different inactivity timeout durations for individual time slots, overriding the room's default setting.

### What Changed

**Before:**
- All time slots used the same `inactivityTimeout` from room settings
- Example: All slots waited 30 minutes before reducing temperature

**After:**
- Each slot can optionally specify its own `inactivityTimeout`
- Falls back to room default if not specified
- Provides fine-grained control per time period

## Configuration

### Room Configuration Structure

```javascript
'RoomName': {
    schedules: {
        weekday: [
            { 
                start: '06:00', 
                end: '14:00', 
                target: 22.5, 
                inactivityOffset: 2.5,
                inactivityTimeout: 60,  // NEW: Optional override
                name: 'School' 
            }
        ]
    },
    settings: {
        inactivityTimeout: 30,  // Default for slots without override
        // ... other settings
    }
}
```

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `inactivityTimeout` (slot) | Number | No | Room default | Minutes to wait before reducing temperature for this slot |
| `inactivityTimeout` (room) | Number | Yes | 30 | Default timeout for slots without override |
| `inactivityOffset` | Number | Yes | 0 | Temperature reduction amount (°C) |

## Usage Examples

### Example 1: School Day with Longer Timeout

**Scenario:** Child at school, wait longer before reducing temperature

```javascript
'Clara': {
    schedules: {
        weekday: [
            { start: '00:00', end: '06:00', target: 20, inactivityOffset: 0, name: 'Night' },
            // School slot: Wait 60 min instead of room default (30 min)
            { start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, 
              inactivityTimeout: 60, name: 'School' },
            // Afternoon: Use room default (30 min)
            { start: '14:00', end: '20:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
        ]
    },
    settings: {
        inactivityTimeout: 30,
        // ... other settings
    }
}
```

**Result:**
- **06:00-14:00 (School):** Waits 60 minutes of inactivity before reducing by 2.5°C
- **14:00-20:00 (Day):** Waits 30 minutes (room default) before reducing by 2.0°C

### Example 2: Living Room with Varied Timeouts

**Scenario:** Different timeout needs throughout the day

```javascript
'Stue': {
    schedules: {
        weekday: [
            { start: '00:00', end: '05:00', target: 21, inactivityOffset: 0, name: 'Night' },
            // Morning: Short timeout (quick response)
            { start: '05:00', end: '07:00', target: 22.5, inactivityOffset: 0, 
              inactivityTimeout: 15, name: 'Morning' },
            // Day: Long timeout (people move in/out)
            { start: '07:00', end: '22:00', target: 22, inactivityOffset: 1, 
              inactivityTimeout: 120, name: 'Day' }
        ]
    },
    settings: {
        inactivityTimeout: 90,  // Room default
        // ... other settings
    }
}
```

**Result:**
- **00:00-05:00 (Night):** No inactivity reduction (offset = 0)
- **05:00-07:00 (Morning):** Waits 15 minutes before reducing
- **07:00-22:00 (Day):** Waits 120 minutes (2 hours) before reducing

### Example 3: Bedroom with Evening Override

**Scenario:** Shorter timeout for evening/bedtime

```javascript
'Soveværelse': {
    schedules: {
        weekday: [
            { start: '00:00', end: '07:00', target: 18, inactivityOffset: 0, name: 'Night' },
            { start: '07:00', end: '20:00', target: 21, inactivityOffset: 1, name: 'Day' }
        ],
        earlyEvening: { 
            start: '20:00', end: '23:59', target: 19, inactivityOffset: 0, 
            inactivityTimeout: 15,  // Quick response for bedtime
            name: 'Evening' 
        }
    },
    settings: {
        inactivityTimeout: 30,
        // ... other settings
    }
}
```

## Status Display

The status script now shows which timeout is active:

```
══ CURRENT SCHEDULE ══
Schedule:       School Day
Time:           10:30
Period:         06:00-14:00 (School)
Base Target:    22.5°C
Inactivity:     -2.5°C after 60 min (slot override)
```

When using room default:
```
Inactivity:     -2.0°C after 30 min (room default)
```

When no inactivity in period:
```
Inactivity:     No offset in this period
```

## Testing Checklist

### Manual Testing

- [x] **Test 1:** Slot with custom timeout uses that timeout
  - Configure slot with `inactivityTimeout: 45`
  - Verify log shows "timeout: 45 min, slot-specific"
  
- [x] **Test 2:** Slot without custom timeout uses room default
  - Configure slot without `inactivityTimeout` field
  - Verify log shows "timeout: 30 min, room default"
  
- [x] **Test 3:** Status script shows correct timeout
  - Run status script
  - Check "Inactivity" line shows correct timeout and source
  
- [x] **Test 4:** Timeout changes when schedule changes
  - Wait for schedule to change from slot A to slot B
  - Verify timeout updates accordingly
  
- [x] **Test 5:** Backward compatibility
  - Test with existing config without slot timeout
  - Verify system works as before

### Validation Steps

1. **Update Configuration:**
   - Edit `room_heating_config.js`
   - Add `inactivityTimeout` to desired slots
   - Run config script to save

2. **Run Heating Control:**
   - Run `room_heating.js` for the room
   - Check logs for timeout information
   - Verify correct timeout is used

3. **Check Status:**
   - Run `room_heating_status.js`
   - Look for "Inactivity" line under "CURRENT SCHEDULE"
   - Verify timeout and source are displayed correctly

4. **Monitor Behavior:**
   - Wait for configured timeout duration
   - Verify temperature reduction occurs at correct time
   - Check diagnostics log for proper recording

## Technical Details

### Modified Files

1. **`room_heating_config.js` (v1.0.4)**
   - Updated version history
   - Documentation for new field
   - Version metadata updated

2. **`room_heating.js` (v10.7.0)**
   - Modified `checkInactivity(inactivityOffset, inactivityTimeout)` function
   - Added `effectiveTimeout` calculation
   - Store `ActiveInactivityTimeout` in global variable
   - Updated all `checkInactivity()` call sites
   - Store `SlotInactivityTimeout` for status display

3. **`room_heating_status.js` (v4.7.0)**
   - Updated `getCurrentScheduleInfo()` to read slot timeout
   - Display timeout with source indicator
   - Show "(slot override)" or "(room default)"

### Global Variables

| Variable | Purpose |
|----------|---------|
| `${zoneName}.Heating.SlotInactivityTimeout` | Current slot's custom timeout (or null) |
| `${zoneName}.Heating.ActiveInactivityTimeout` | Currently active timeout being used |

### Fallback Logic

```javascript
const effectiveTimeout = slotInactivityTimeout || roomSettings.inactivityTimeout;
```

## Migration Guide

### Existing Configurations

No changes required! Existing configurations continue to work:
- Slots without `inactivityTimeout` use room default
- All current behavior is preserved

### Adding Slot-Specific Timeouts

1. Identify slots that need different timeouts
2. Add `inactivityTimeout: <minutes>` field to those slots
3. Run config script to save changes
4. Test with status script

Example:
```javascript
// Before
{ start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, name: 'School' }

// After
{ start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, 
  inactivityTimeout: 60, name: 'School' }
```

## Common Use Cases

### 1. School/Work Hours
- **Need:** Longer timeout when occupants are predictably away
- **Solution:** Set `inactivityTimeout: 60-120` for those hours
- **Benefit:** Maintains comfortable temp even with no motion detection

### 2. Living Room
- **Need:** Long timeout for high-traffic areas with intermittent presence
- **Solution:** Set `inactivityTimeout: 90-120` for day periods
- **Benefit:** Avoids temperature drops during normal activity patterns

### 3. Bedtime
- **Need:** Quick response when preparing for sleep
- **Solution:** Set `inactivityTimeout: 15` for evening slots
- **Benefit:** Temperature drops quickly when activity stops

### 4. Morning Routine
- **Need:** Quick warmup, fast response
- **Solution:** Set `inactivityTimeout: 10-15` for morning slots
- **Benefit:** Responsive to morning preparation activities

## Troubleshooting

### Issue: Timeout Not Working

**Check:**
1. Config script run after changes?
2. Slot has `inactivityOffset` > 0? (timeout only matters if offset exists)
3. Status script shows correct timeout?

### Issue: Wrong Timeout Used

**Check:**
1. Spelling of `inactivityTimeout` field (camelCase)
2. Value is a number, not string
3. Global variable `SlotInactivityTimeout` has correct value

### Issue: Status Shows Wrong Source

**Verify:**
- If slot has `inactivityTimeout` → Should show "(slot override)"
- If slot doesn't have it → Should show "(room default)"

## Best Practices

1. **Start Conservative:** Use room defaults initially, add overrides only where needed
2. **Document Reasoning:** Comment why specific slots need custom timeouts
3. **Test Thoroughly:** Monitor for full day to verify behavior
4. **Review Periodically:** Adjust timeouts based on actual usage patterns
5. **Consider Seasonality:** May need different settings for summer vs. winter

## Example Complete Configuration

```javascript
'Clara': {
    zoneName: 'Claras værelse',
    heating: {
        type: 'smart_plug',
        hysteresis: 0.5,
        devices: ['device-id-1', 'device-id-2']
    },
    schedules: {
        weekday: [
            { start: '00:00', end: '06:00', target: 20, inactivityOffset: 0, name: 'Night' },
            { start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, 
              inactivityTimeout: 60, name: 'School' },
            { start: '14:00', end: '20:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
        ],
        weekend: [
            { start: '00:00', end: '08:00', target: 20, inactivityOffset: 0, name: 'Night' },
            { start: '08:00', end: '21:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
        ],
        earlyEvening: { 
            start: '20:00', end: '23:59', target: 20, inactivityOffset: 0, 
            inactivityTimeout: 15, name: 'Evening' 
        }
    },
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,  // Default
        windowOpenTimeout: 60,
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    }
}
```

## Summary

The per-slot inactivity timeout feature provides flexible, fine-grained control over heating behavior throughout the day. Use it to:
- Adapt to different occupancy patterns
- Optimize comfort vs. energy efficiency
- Customize behavior for specific time periods
- Maintain existing behavior where it works well

**Backward Compatible:** Existing configurations work unchanged.  
**Optional Enhancement:** Add timeouts only where needed.  
**Easy to Use:** Simple numeric field in slot configuration.
