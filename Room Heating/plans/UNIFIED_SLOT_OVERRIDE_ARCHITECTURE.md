# Unified Slot-Override Architecture Plan

**Version:** 2.0 (Architecture Enhancement)  
**Date:** 2026-01-17  
**Author:** Henrik Skovgaard  
**Status:** Design Phase

## Executive Summary

Extend the slot-override pattern to create a unified, flexible configuration system where:
1. **Room settings** provide sensible defaults
2. **Time slots** can override any relevant setting
3. **Fallback logic** ensures backward compatibility

## Current State Analysis

### Existing Room Settings
```javascript
settings: {
    tadoAwayMinTemp: 17.0,           // Away mode minimum temp
    inactivityTimeout: 30,           // ✓ Now slot-overridable
    windowOpenTimeout: 60,           // Seconds before turning off heat
    windowClosedDelay: 600,          // Seconds to wait after window closes
    manualOverrideDuration: 90       // Minutes for manual override
}
```

### Existing Slot Configuration
```javascript
{ 
    start: '06:00',                  // Required
    end: '14:00',                    // Required
    target: 22.5,                    // Required
    inactivityOffset: 2.5,           // Required (but should have default)
    inactivityTimeout: 60,           // ✓ New: Optional override
    name: 'School'                   // Required
}
```

## Proposed Enhancement: Unified Override System

### Design Principles

1. **Consistency**: All slot-relevant settings use the same override pattern
2. **Backward Compatibility**: Existing configs work unchanged
3. **Sensible Defaults**: Room settings provide reasonable fallbacks
4. **Clear Documentation**: Override source clearly indicated

### Settings Classification

| Setting | Room Default? | Slot Override? | Rationale |
|---------|---------------|----------------|-----------|
| **inactivityTimeout** | ✅ Yes | ✅ Yes (implemented) | Time periods have different occupancy patterns |
| **inactivityOffset** | ✅ Yes (NEW) | ✅ Yes (current) | Should be optional with room default |
| **windowOpenTimeout** | ✅ Yes | ✅ Yes (proposed) | Night may need different handling than day |
| **windowClosedDelay** | ✅ Yes | ⚠️ Maybe | Less common need, but possible |
| **tadoAwayMinTemp** | ✅ Yes | ❌ No | Away mode is room-wide, not time-based |
| **manualOverrideDuration** | ✅ Yes | ❌ No | User behavior, not schedule-dependent |

## Detailed Design

### 1. Room-Level Default for `inactivityOffset`

**Current Problem:**
- Every slot must specify `inactivityOffset`
- Repetitive when most slots use the same offset

**Proposed Solution:**
```javascript
'Clara': {
    settings: {
        inactivityTimeout: 30,           // Default timeout
        inactivityOffset: 2.0,           // NEW: Default offset
        // ... other settings
    },
    schedules: {
        weekday: [
            // Uses defaults: 30 min timeout, 2.0°C offset
            { start: '00:00', end: '06:00', target: 20, name: 'Night' },
            
            // Override both
            { start: '06:00', end: '14:00', target: 22.5, 
              inactivityOffset: 2.5, inactivityTimeout: 60, name: 'School' },
            
            // Override only offset (uses default timeout)
            { start: '14:00', end: '20:00', target: 22.5, 
              inactivityOffset: 3.0, name: 'Day' }
        ]
    }
}
```

**Benefits:**
- Less repetition in configuration
- Easier to adjust "standard" offset for entire room
- Still allows per-slot customization

### 2. Slot-Override for `windowOpenTimeout`

**Use Case:**
Night periods might need different window handling than day periods.

**Example:**
```javascript
'Clara': {
    settings: {
        windowOpenTimeout: 60,          // Default: 1 minute
        // ... other settings
    },
    schedules: {
        weekday: [
            // Night: Tolerate longer window opening (airing out)
            { start: '00:00', end: '06:00', target: 20, 
              windowOpenTimeout: 300, name: 'Night' },  // 5 minutes
            
            // Day: Use default (60 seconds)
            { start: '06:00', end: '14:00', target: 22.5, name: 'School' }
        ]
    }
}
```

**Benefits:**
- Different tolerance for window opening at different times
- Night airing without turning off heat immediately
- Day periods remain responsive

### 3. Optional: Slot-Override for `windowClosedDelay`

**Use Case:**
Less common, but some periods might need faster/slower resume.

**Example:**
```javascript
'Stue': {
    settings: {
        windowClosedDelay: 600,         // Default: 10 minutes
        // ... other settings
    },
    schedules: {
        weekday: [
            // Morning: Quick resume (less cold air settles)
            { start: '05:00', end: '07:00', target: 22.5, 
              windowClosedDelay: 300, name: 'Morning' },  // 5 minutes
            
            // Day: Use default (600 seconds)
            { start: '07:00', end: '22:00', target: 22, name: 'Day' }
        ]
    }
}
```

## Implementation Architecture

### Fallback Pattern

**Generic helper function:**
```javascript
function getEffectiveSetting(slot, settingName, roomDefault) {
    return slot[settingName] !== undefined ? slot[settingName] : roomDefault;
}

// Usage examples:
const effectiveOffset = getEffectiveSetting(slot, 'inactivityOffset', ROOM.settings.inactivityOffset);
const effectiveTimeout = getEffectiveSetting(slot, 'inactivityTimeout', ROOM.settings.inactivityTimeout);
const effectiveWindowTimeout = getEffectiveSetting(slot, 'windowOpenTimeout', ROOM.settings.windowOpenTimeout);
```

### Configuration Schema

**Complete slot with all possible overrides:**
```javascript
{
    // Required fields
    start: '06:00',
    end: '14:00',
    target: 22.5,
    name: 'School',
    
    // Optional overrides (use room default if not specified)
    inactivityOffset: 2.5,           // Override room default
    inactivityTimeout: 60,           // Override room default
    windowOpenTimeout: 120,          // Override room default
    windowClosedDelay: 300           // Override room default (if implemented)
}
```

**Minimal slot (uses all room defaults):**
```javascript
{
    start: '00:00',
    end: '06:00',
    target: 20,
    name: 'Night'
    // All other settings use room defaults
}
```

## Migration Strategy

### Phase 1: Add Room-Level `inactivityOffset` Default ⭐
**Priority:** HIGH (immediate improvement)

1. Add `inactivityOffset` to room `settings`
2. Modify code to use `slot.inactivityOffset || ROOM.settings.inactivityOffset`
3. Update documentation
4. Migrate existing configs (optional - they still work)

### Phase 2: Add `windowOpenTimeout` Slot Override
**Priority:** MEDIUM (nice-to-have)

1. Implement slot-level override
2. Add helper function for fallback
3. Update logging to show source
4. Document use cases

### Phase 3: Add `windowClosedDelay` Slot Override
**Priority:** LOW (edge cases only)

1. Similar implementation to windowOpenTimeout
2. Less common use case
3. Complete for consistency

### Phase 4: Create Helper Utilities
**Priority:** MEDIUM (refactoring)

1. Extract common fallback pattern
2. Create `getEffectiveSetting()` helper
3. Refactor existing code to use helper
4. Add validation utilities

## Configuration Examples

### Example 1: Child's Bedroom (Comprehensive)
```javascript
'Clara': {
    zoneName: 'Claras værelse',
    heating: { type: 'smart_plug', hysteresis: 0.5, devices: ['...'] },
    
    schedules: {
        weekday: [
            // Night: Minimal settings, allow window airing
            { start: '00:00', end: '06:00', target: 20, 
              inactivityOffset: 0, windowOpenTimeout: 300, name: 'Night' },
            
            // School: Custom timeout, standard offset
            { start: '06:00', end: '14:00', target: 22.5, 
              inactivityTimeout: 60, name: 'School' },
            
            // Afternoon: Higher offset for active play
            { start: '14:00', end: '20:00', target: 22.5, 
              inactivityOffset: 3.0, name: 'Day' }
        ],
        weekend: [
            // Simple slots using mostly defaults
            { start: '00:00', end: '08:00', target: 20, name: 'Night' },
            { start: '08:00', end: '21:00', target: 22.5, name: 'Day' }
        ]
    },
    
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 30,          // Default for most slots
        inactivityOffset: 2.0,          // NEW: Default offset
        windowOpenTimeout: 60,          // Default for most slots
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    }
}
```

### Example 2: Living Room (Multiple Zones of Activity)
```javascript
'Stue': {
    zoneName: 'Stue / Spisestue',
    heating: { type: 'tado_valve', devices: ['...'] },
    
    schedules: {
        weekday: [
            // Night: No inactivity reduction
            { start: '00:00', end: '05:00', target: 21, 
              inactivityOffset: 0, name: 'Night' },
            
            // Morning rush: Quick response, short timeout
            { start: '05:00', end: '07:00', target: 22.5, 
              inactivityTimeout: 15, windowClosedDelay: 300, name: 'Morning' },
            
            // Day: Long timeout (people in/out), normal window handling
            { start: '07:00', end: '22:00', target: 22, 
              inactivityTimeout: 120, name: 'Day' }
        ]
    },
    
    settings: {
        tadoAwayMinTemp: 17.0,
        inactivityTimeout: 90,          // Long default for living room
        inactivityOffset: 1.0,          // NEW: Gentle reduction
        windowOpenTimeout: 60,
        windowClosedDelay: 600,
        manualOverrideDuration: 90
    }
}
```

## Status Display Enhancement

**Current SCHEDULE section:**
```
══ CURRENT SCHEDULE ══
Schedule:       School Day
Time:           10:30
Period:         06:00-14:00 (School)
Base Target:    22.5°C
Inactivity:     -2.5°C after 60 min (slot override)
```

**Enhanced SCHEDULE section:**
```
══ CURRENT SCHEDULE ══
Schedule:       School Day
Time:           10:30
Period:         06:00-14:00 (School)
Base Target:    22.5°C
Inactivity:     -2.5°C (slot) after 60 min (slot)
Window:         120 sec timeout (slot), 600 sec settle (default)
```

**Alternative compact format:**
```
══ CURRENT SCHEDULE ══
Schedule:       School Day
Time:           10:30
Period:         06:00-14:00 (School)
Target:         22.5°C
Inactivity:     -2.5°C @ 60min [both custom]
Window:         120s timeout [custom], 600s settle [default]
```

## Code Architecture Changes

### Helper Functions Module

```javascript
// ============================================================================
// Configuration Helpers - Slot Override Pattern
// ============================================================================

/**
 * Get effective setting value with slot override support
 * @param {Object} slot - Current time slot
 * @param {string} settingName - Name of setting to retrieve
 * @param {any} roomDefault - Room-level default value
 * @returns {any} Slot value if defined, otherwise room default
 */
function getEffectiveSetting(slot, settingName, roomDefault) {
    const slotValue = slot[settingName];
    return slotValue !== undefined ? slotValue : roomDefault;
}

/**
 * Get setting source indicator for logging/display
 * @param {Object} slot - Current time slot
 * @param {string} settingName - Name of setting
 * @returns {string} 'slot' or 'room default'
 */
function getSettingSource(slot, settingName) {
    return slot[settingName] !== undefined ? 'slot override' : 'room default';
}

/**
 * Get all effective settings for a slot
 * @param {Object} slot - Current time slot
 * @param {Object} roomSettings - Room settings object
 * @returns {Object} Complete settings with all overrides resolved
 */
function getEffectiveSlotSettings(slot, roomSettings) {
    return {
        target: slot.target,
        inactivityOffset: getEffectiveSetting(slot, 'inactivityOffset', roomSettings.inactivityOffset),
        inactivityTimeout: getEffectiveSetting(slot, 'inactivityTimeout', roomSettings.inactivityTimeout),
        windowOpenTimeout: getEffectiveSetting(slot, 'windowOpenTimeout', roomSettings.windowOpenTimeout),
        windowClosedDelay: getEffectiveSetting(slot, 'windowClosedDelay', roomSettings.windowClosedDelay)
    };
}
```

### Usage in Main Code

```javascript
// Instead of:
const inactivityOffset = currentSlot.inactivityOffset || 0;
const inactivityTimeout = currentSlot.inactivityTimeout || ROOM.settings.inactivityTimeout;

// Use:
const effectiveSettings = getEffectiveSlotSettings(currentSlot, ROOM.settings);

// Access as:
effectiveSettings.inactivityOffset
effectiveSettings.inactivityTimeout
effectiveSettings.windowOpenTimeout
effectiveSettings.windowClosedDelay
```

## Testing Plan

### Unit Tests (Conceptual)

```javascript
// Test 1: Slot with all overrides
const slot = {
    start: '06:00', end: '14:00', target: 22.5,
    inactivityOffset: 3.0,
    inactivityTimeout: 90,
    windowOpenTimeout: 120,
    name: 'School'
};
const settings = getEffectiveSlotSettings(slot, ROOM.settings);
assert(settings.inactivityOffset === 3.0);       // Slot override
assert(settings.inactivityTimeout === 90);       // Slot override
assert(settings.windowOpenTimeout === 120);      // Slot override

// Test 2: Slot with no overrides
const slot = {
    start: '00:00', end: '06:00', target: 20, name: 'Night'
};
const settings = getEffectiveSlotSettings(slot, ROOM.settings);
assert(settings.inactivityOffset === ROOM.settings.inactivityOffset);    // Room default
assert(settings.inactivityTimeout === ROOM.settings.inactivityTimeout);  // Room default

// Test 3: Mixed overrides
const slot = {
    start: '14:00', end: '20:00', target: 22.5,
    inactivityTimeout: 45,  // Override timeout only
    name: 'Afternoon'
};
const settings = getEffectiveSlotSettings(slot, ROOM.settings);
assert(settings.inactivityOffset === ROOM.settings.inactivityOffset);    // Room default
assert(settings.inactivityTimeout === 45);                                // Slot override
```

## Benefits Summary

### For Users
- ✅ Less repetitive configuration
- ✅ Easier to maintain (change room defaults)
- ✅ Fine-grained control when needed
- ✅ Clear indication of overrides in status

### For System
- ✅ Consistent override pattern
- ✅ Maintainable code architecture
- ✅ Easy to extend with new settings
- ✅ Backward compatible

## Implementation Timeline

| Phase | Description | Effort | Priority |
|-------|-------------|--------|----------|
| 1 | Room-level inactivityOffset default | Small | HIGH |
| 2 | windowOpenTimeout slot override | Medium | MEDIUM |
| 3 | Helper function utilities | Small | MEDIUM |
| 4 | windowClosedDelay slot override | Small | LOW |
| 5 | Enhanced status display | Medium | MEDIUM |
| 6 | Complete documentation | Medium | HIGH |

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing configs | HIGH | Maintain backward compatibility with fallbacks |
| Configuration complexity | MEDIUM | Good documentation, clear examples |
| Code maintenance | LOW | Use helper functions, consistent pattern |
| Testing burden | MEDIUM | Comprehensive examples, validation tools |

## Future Extensions

### Possible Additional Overrides

1. **Target temperature adjustments**
   - Slot-level `targetAdjustment` for manual tuning
   - Example: `targetAdjustment: -0.5` to make slot 0.5°C cooler

2. **Hysteresis overrides** (smart plugs)
   - Different dead-bands for different periods
   - Example: Tighter control during occupied hours

3. **Heating aggressiveness**
   - How quickly to respond to temperature changes
   - Example: Faster ramp-up in morning

4. **Multi-condition overrides**
   - Override based on day type + time
   - Example: Different settings for rainy days

## Conclusion

This unified architecture provides:
- **Flexibility**: Fine-grained control per time slot
- **Simplicity**: Sensible defaults reduce configuration
- **Consistency**: Same pattern for all override-able settings
- **Maintainability**: Easy to extend and modify

**Recommendation:** Implement in phases, starting with high-priority room-level `inactivityOffset` default, then add window-related overrides as needed.
