# Unified Slot-Override System

**Version:** 1.0.5 (Config) / 10.8.0 (Heating) / 4.8.0 (Status)  
**Date:** 2026-01-17  
**Author:** Henrik Skovgaard

## Overview

The unified slot-override system provides a consistent, flexible architecture where room-level settings provide sensible defaults, and individual time slots can override these settings when needed. This reduces configuration repetition while maintaining fine-grained control.

## Architecture Principles

### 1. Consistent Override Pattern

All override-able settings use the same pattern:
```javascript
const effectiveValue = slot.setting !== undefined ? slot.setting : roomSettings.setting;
```

### 2. Fallback Logic

- **Slot value defined**: Use slot value
- **Slot value undefined**: Use room default
- **Clear indication**: Status shows source ("slot" or "room")

### 3. Backward Compatibility

Existing configurations without slot overrides continue to work unchanged.

## Supported Overrides

| Setting | Type | Room Default | Slot Override | Use Cases |
|---------|------|--------------|---------------|-----------|
| **inactivityOffset** | Number (°C) | Required | Optional | Different temp reductions per period |
| **inactivityTimeout** | Number (min) | Required | Optional | Different wait times per period |
| **windowOpenTimeout** | Number (sec) | Required | Optional | Night vs. day tolerance |
| **windowClosedDelay** | Number (sec) | Required | Optional | Variable air-settle time |

## Configuration Structure

### Complete Example

```javascript
'Clara': {
    zoneName: 'Claras værelse',
    heating: {
        type: 'smart_plug',
        hysteresis: 0.5,
        devices: ['device-id-1', 'device-id-2']
    },
    
    // Room-level defaults (used when slot doesn't override)
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,          // Default: 30 min wait
        inactivityOffset: 2.0,          // Default: 2°C reduction
        windowOpenTimeout: 60,          // Default: 60 sec before turning off
        windowClosedDelay: 600,         // Default: 10 min air settle time
        manualOverrideDuration: 90
    },
    
    schedules: {
        weekday: [
            // Night: Minimal config uses all room defaults
            { start: '00:00', end: '06:00', target: 20, name: 'Night' },
            
            // School: Override multiple settings
            { start: '06:00', end: '14:00', target: 22.5,
              inactivityOffset: 2.5,      // Override: Higher reduction
              inactivityTimeout: 60,       // Override: Longer wait
              windowOpenTimeout: 120,      // Override: More tolerance
              name: 'School' },
            
            // Day: Override only offset (uses other room defaults)
            { start: '14:00', end: '20:00', target: 22.5,
              inactivityOffset: 3.0,       // Override: Highest reduction
              name: 'Day' }
        ],
        
        weekend: [
            // Simple config using room defaults
            { start: '00:00', end: '08:00', target: 20, name: 'Night' },
            { start: '08:00', end: '21:00', target: 22.5, name: 'Day' }
        ],
        
        // Evening with specific settings
        earlyEvening: { 
            start: '20:00', end: '23:59', target: 20,
            inactivityTimeout: 15,          // Override: Quick response for bedtime
            windowClosedDelay: 300,         // Override: Faster resume
            name: 'Evening' 
        }
    }
}
```

### Minimal Example (Room Defaults Only)

```javascript
'Soveværelse': {
    zoneName: 'Soveværelse',
    heating: {
        type: 'tado_valve',
        devices: ['device-id']
    },
    
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,
        inactivityOffset: 1.0,          // Will be used for all slots
        windowOpenTimeout: 60,
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    },
    
    schedules: {
        weekday: [
            // All slots use room defaults - no overrides needed
            { start: '00:00', end: '07:00', target: 18, name: 'Night' },
            { start: '07:00', end: '20:00', target: 21, name: 'Day' }
        ]
    }
}
```

## Setting Details

### inactivityOffset

**Purpose:** Temperature reduction when room is inactive  
**Type:** Number (degrees Celsius)  
**Room Default:** Required (e.g., `inactivityOffset: 2.0`)  
**Slot Override:** Optional (e.g., `inactivityOffset: 3.0`)

**Use Cases:**
- **Higher reduction** for active periods (more energy savings)
- **Lower reduction** for passive periods (maintain comfort)
- **Zero** for periods with no inactivity detection (e.g., night)

**Example:**
```javascript
settings: {
    inactivityOffset: 2.0  // Default: 2°C reduction
},
schedules: {
    weekday: [
        // Night: No reduction
        { start: '00:00', end: '06:00', target: 20, 
          inactivityOffset: 0, name: 'Night' },
        
        // Day: Higher reduction (active household)
        { start: '06:00', end: '20:00', target: 22.5, 
          inactivityOffset: 3.0, name: 'Day' }
    ]
}
```

### inactivityTimeout

**Purpose:** Minutes of inactivity before reducing temperature  
**Type:** Number (minutes)  
**Room Default:** Required (e.g., `inactivityTimeout: 30`)  
**Slot Override:** Optional (e.g., `inactivityTimeout: 60`)

**Use Cases:**
- **Longer timeout** when occupants are predictably away (school/work)
- **Shorter timeout** for quick response (bedtime preparation)
- **Very long timeout** for high-traffic areas with intermittent presence

**Example:**
```javascript
settings: {
    inactivityTimeout: 30  // Default: 30 min wait
},
schedules: {
    weekday: [
        // School hours: Wait longer (child at school)
        { start: '06:00', end: '14:00', target: 22.5,
          inactivityTimeout: 60, name: 'School' },
        
        // Evening: Quick response for bedtime
        { start: '20:00', end: '23:59', target: 20,
          inactivityTimeout: 15, name: 'Evening' }
    ]
}
```

### windowOpenTimeout

**Purpose:** Seconds window can be open before turning off heating  
**Type:** Number (seconds)  
**Room Default:** Required (e.g., `windowOpenTimeout: 60`)  
**Slot Override:** Optional (e.g., `windowOpenTimeout: 300`)

**Use Cases:**
- **Longer timeout** for night airing (intentional ventilation)
- **Shorter timeout** for day periods (quick response to forgotten windows)
- **Variable tolerance** based on outdoor temperature season

**Example:**
```javascript
settings: {
    windowOpenTimeout: 60  // Default: 1 minute
},
schedules: {
    weekday: [
        // Night: Allow longer window opening (airing out)
        { start: '00:00', end: '06:00', target: 20,
          windowOpenTimeout: 300, name: 'Night' },  // 5 minutes
        
        // Day: Quick response (forgot to close window)
        { start: '06:00', end: '20:00', target: 22.5,
          windowOpenTimeout: 45, name: 'Day' }  // 45 seconds
    ]
}
```

### windowClosedDelay

**Purpose:** Seconds to wait after window closes for air to settle  
**Type:** Number (seconds)  
**Room Default:** Required (e.g., `windowClosedDelay: 600`)  
**Slot Override:** Optional (e.g., `windowClosedDelay: 300`)

**Use Cases:**
- **Shorter delay** for morning (faster warmup needed)
- **Longer delay** for evening (more cold air settled)
- **Variable delay** based on season/outdoor temperature

**Example:**
```javascript
settings: {
    windowClosedDelay: 600  // Default: 10 minutes
},
schedules: {
    weekday: [
        // Morning: Quick resume (need warmth for morning routine)
        { start: '05:00', end: '07:00', target: 22.5,
          windowClosedDelay: 300, name: 'Morning' },  // 5 minutes
        
        // Day: Standard delay
        { start: '07:00', end: '22:00', target: 22,
          windowClosedDelay: 600, name: 'Day' }  // 10 minutes
    ]
}
```

## Status Display

### Enhanced Schedule Section

The status script now shows all effective settings and their sources:

```
══ CURRENT SCHEDULE ══
Schedule:       School Day
Time:           10:30
Period:         06:00-14:00 (School)
Base Target:    22.5°C
Inactivity:     -2.5°C (slot) after 60 min (slot)
Window Open:    120 sec timeout (slot)
Window Closed:  10 min settle delay (room)
```

**Source Indicators:**
- `(slot)` - Value is from slot override
- `(room)` - Value is from room default

### Example Output Scenarios

**Scenario 1: All Room Defaults**
```
Inactivity:     -2.0°C (room) after 30 min (room)
Window Open:    60 sec timeout (room)
Window Closed:  10 min settle delay (room)
```

**Scenario 2: Mixed Overrides**
```
Inactivity:     -3.0°C (slot) after 30 min (room)
Window Open:    120 sec timeout (slot)
Window Closed:  10 min settle delay (room)
```

**Scenario 3: All Slot Overrides**
```
Inactivity:     -2.5°C (slot) after 60 min (slot)
Window Open:    300 sec timeout (slot)
Window Closed:  5 min settle delay (slot)
```

## Logging Enhancements

The heating control script now logs override sources:

```
💤 Zone inactive for 35 minutes
   Timeout: 60 min (slot override), Offset: 2.5°C (slot override)
```

```
⏱️  Window opened - starting 300 sec timeout (slot override)
```

```
✓ Window closed (was open 320s) - waiting 5 min for air to settle (slot override)
```

## Common Use Cases

### 1. Child's Bedroom

**Need:** Different behavior for school days vs. weekends

```javascript
'Clara': {
    settings: {
        inactivityTimeout: 30,
        inactivityOffset: 2.0,
        windowOpenTimeout: 60,
        windowClosedDelay: 600
    },
    schedules: {
        weekday: [
            { start: '00:00', end: '06:00', target: 20, 
              inactivityOffset: 0, name: 'Night' },
            
            // School: Wait longer, maintain warmth
            { start: '06:00', end: '14:00', target: 22.5,
              inactivityTimeout: 60, inactivityOffset: 2.5, name: 'School' },
            
            // After school: Higher reduction when playing elsewhere
            { start: '14:00', end: '20:00', target: 22.5,
              inactivityOffset: 3.0, name: 'Day' }
        ],
        weekend: [
            // Simple weekend schedule uses defaults
            { start: '00:00', end: '08:00', target: 20, name: 'Night' },
            { start: '08:00', end: '21:00', target: 22.5, name: 'Day' }
        ]
    }
}
```

### 2. Living Room

**Need:** Long timeout for high-traffic area, variable window handling

```javascript
'Stue': {
    settings: {
        inactivityTimeout: 90,          // Long default
        inactivityOffset: 1.0,          // Gentle reduction
        windowOpenTimeout: 60,
        windowClosedDelay: 600
    },
    schedules: {
        weekday: [
            // Morning rush: Quick window response, fast resume
            { start: '05:00', end: '07:00', target: 22.5,
              inactivityTimeout: 15,            // Quick response
              windowOpenTimeout: 45,             // Short tolerance
              windowClosedDelay: 300, name: 'Morning' },
            
            // Day: Very long timeout (people in/out)
            { start: '07:00', end: '22:00', target: 22,
              inactivityTimeout: 120, name: 'Day' }    // 2 hours
        ]
    }
}
```

### 3. Bedroom

**Need:** Different evening behavior, quick bedtime response

```javascript
'Soveværelse': {
    settings: {
        inactivityTimeout: 30,
        inactivityOffset: 1.0,
        windowOpenTimeout: 60,
        windowClosedDelay: 600
    },
    schedules: {
        weekday: [
            // Night: Allow window airing
            { start: '00:00', end: '07:00', target: 18,
              inactivityOffset: 0,
              windowOpenTimeout: 300, name: 'Night' },    // 5 min for airing
            
            { start: '07:00', end: '20:00', target: 21, name: 'Day' }
        ],
        earlyEvening: {
            start: '20:00', end: '23:59', target: 19,
            inactivityTimeout: 15,          // Quick for bedtime prep
            name: 'Evening'
        }
    }
}
```

## Migration Guide

### From Old System (Required inactivityOffset on Every Slot)

**Before:**
```javascript
settings: {
    inactivityTimeout: 30
    // No inactivityOffset default
},
schedules: {
    weekday: [
        { start: '00:00', end: '06:00', target: 20, inactivityOffset: 0, name: 'Night' },
        { start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, name: 'School' },
        { start: '14:00', end: '20:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
    ]
}
```

**After (Option 1: Keep As-Is - Still Works!):**
```javascript
settings: {
    inactivityTimeout: 30,
    inactivityOffset: 2.0       // Add room default
    // Now slots can omit if they use 2.0
},
schedules: {
    weekday: [
        // Keep explicit offsets - backward compatible
        { start: '00:00', end: '06:00', target: 20, inactivityOffset: 0, name: 'Night' },
        { start: '06:00', end: '14:00', target: 22.5, inactivityOffset: 2.5, name: 'School' },
        { start: '14:00', end: '20:00', target: 22.5, inactivityOffset: 2.0, name: 'Day' }
    ]
}
```

**After (Option 2: Simplify Using Defaults):**
```javascript
settings: {
    inactivityTimeout: 30,
    inactivityOffset: 2.0       // Default offset
},
schedules: {
    weekday: [
        { start: '00:00', end: '06:00', target: 20, 
          inactivityOffset: 0, name: 'Night' },           // Override to 0
        { start: '06:00', end: '14:00', target: 22.5, 
          inactivityOffset: 2.5, name: 'School' },        // Override to 2.5
        { start: '14:00', end: '20:00', target: 22.5, name: 'Day' }  // Use default 2.0
    ]
}
```

## Best Practices

### 1. Start with Room Defaults

Set sensible room-level defaults that work for most periods:
```javascript
settings: {
    inactivityTimeout: 30,      // Good general default
    inactivityOffset: 2.0,      // Moderate energy savings
    windowOpenTimeout: 60,      // One minute tolerance
    windowClosedDelay: 600      // Standard 10 minutes
}
```

### 2. Override Only When Needed

Don't override just to override - only when the period truly needs different behavior:
```javascript
// ✅ Good: Override for specific need
{ start: '06:00', end: '14:00', target: 22.5,
  inactivityTimeout: 60,  // Child at school - wait longer
  name: 'School' }

// ❌ Bad: Unnecessary override (same as room default)
{ start: '14:00', end: '20:00', target: 22.5,
  inactivityTimeout: 30,  // Same as room default - just omit!
  name: 'Day' }
```

### 3. Document Reasoning

Add comments explaining why overrides are needed:
```javascript
// Morning: Quick window response for forgotten windows during morning rush
{ start: '05:00', end: '07:00', target: 22.5,
  windowOpenTimeout: 45, windowClosedDelay: 300, name: 'Morning' }
```

### 4. Test Thoroughly

After adding overrides:
1. Run config script to save changes
2. Run status script to verify settings display correctly
3. Monitor for full day to observe behavior
4. Adjust based on actual usage patterns

### 5. Review Periodically

Settings may need adjustment:
- **Seasonal**: Winter vs. summer window tolerance
- **Occupancy**: Changes in household routines
- **Energy costs**: Balance comfort vs. savings

## Troubleshooting

### Issue: Override Not Working

**Symptoms:** Slot override not being used, room default used instead

**Check:**
1. Config script run after changes?
2. Spelling correct? (camelCase: `inactivityOffset` not `inactivity_offset`)
3. Value is number, not string? (`60` not `"60"`)
4. Status script shows slot override?

**Example Debug:**
```javascript
// Wrong:
{ start: '06:00', end: '14:00', target: 22.5,
  inactivity_timeout: 60, name: 'School' }  // Wrong name!

// Correct:
{ start: '06:00', end: '14:00', target: 22.5,
  inactivityTimeout: 60, name: 'School' }   // camelCase
```

### Issue: Status Shows Wrong Source

**Symptoms:** Status shows "(room)" but should show "(slot)"

**Verify:**
- Slot has the field defined
- Field name matches exactly
- Config saved successfully

### Issue: Unexpected Behavior

**Symptoms:** System not behaving as expected with overrides

**Debug Steps:**
1. Check logs for "slot override" vs "room default" messages
2. Verify status script shows expected effective values
3. Check global variables:
   - `${zoneName}.Heating.SlotInactivityTimeout`
   - `${zoneName}.Heating.SlotWindowOpenTimeout`
   - `${zoneName}.Heating.SlotWindowClosedDelay`

## Summary

The unified slot-override system provides:

✅ **Consistency** - Same pattern for all override-able settings  
✅ **Flexibility** - Fine-grained control per time period  
✅ **Simplicity** - Room defaults reduce repetition  
✅ **Clarity** - Status clearly shows override sources  
✅ **Backward Compatible** - Existing configs work unchanged  

**Key Principle:** Set it once at room level, override only when needed for specific periods.

## Version History

- **1.0.5 (2026-01-17)**: Unified slot-override system implemented
- **1.0.4 (2026-01-17)**: Initial per-slot inactivityTimeout support
