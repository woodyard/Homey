# Tado Manual Control Detection Guide

## Overview

This document explains how to use the [`inspect_tado_properties.js`](../inspect_tado_properties.js) script to identify if manual control is enabled on a Tado device and understand the device's complete property structure.

## Purpose

The script was created to:
1. **Inspect all properties** available on a Tado device
2. **Identify manual control indicators** (overlay mode, manual mode, etc.)
3. **Understand device capabilities** and their current values
4. **Find hidden properties** that might contain control state information

## Usage

### 1. Configure the Script

Open [`inspect_tado_properties.js`](../inspect_tado_properties.js) and update the device ID:

```javascript
const TADO_DEVICE_ID = '2ca14bef-8a28-43cc-af70-0d0611f5281f'; // Your device ID
```

You can find your Tado device ID from:
- The [`room_heating_config.js`](../room_heating_config.js) configuration
- Existing test scripts like [`test_tado_capabilities.js`](../test_tado_capabilities.js)
- Homey's device settings

### 2. Run the Script

Execute the script in HomeyScript to generate a comprehensive property report.

### 3. Review the Output

The script outputs 10 detailed sections:

## Output Sections Explained

### Section 1: Basic Device Information
- Device name, ID, zone, driver information
- Quick overview of device identity and location

### Section 2: Capabilities List
- Simple list of all available capabilities
- Shows what the device can do (measure temperature, set target, etc.)

### Section 3: Capabilities Details
- **Most important section for manual control detection**
- Shows current values for all capabilities
- Look for:
  - `tado_overlay` - indicates manual override is active
  - `tado_control_mode` - shows AUTO vs MANUAL mode
  - `target_temperature` - current target (compare with schedule)

### Section 4: Manual Control Indicators
- **Automated analysis** of overlay/manual/mode capabilities
- Highlights likely manual control properties
- Shows current values and their meanings

### Section 5: Device Settings
- Configuration settings stored on the device
- May contain preferences related to manual control
- Check for `manualControl`, `overlay`, or `controlMode` settings

### Section 6: Device Store (Internal Data)
- Internal state data maintained by the driver
- May contain overlay state or manual override flags
- Look for `lastManualChange`, `overlay`, `manualOverride`

### Section 7: Device Data
- Device-specific data like zone IDs, device IDs
- Usually Tado API identifiers
- Less likely to contain manual control info

### Section 8: All Device Properties
- Comprehensive list of every property on the device object
- Shows unknown/undocumented properties
- **Check this section if manual control isn't found in earlier sections**

### Section 9: Raw JSON Output
- Complete device object as JSON
- Useful for searching with text editors
- Can search for keywords: "manual", "overlay", "mode", "override"

### Section 10: Interpretation Guide
- Built-in help on interpreting the results
- Explains common patterns for manual control detection
- Provides next steps based on findings

## What to Look For

### Primary Indicators of Manual Control

1. **`tado_overlay` capability**
   - Value: `true` or `false`
   - When `true`, device is in manual override mode
   - This is the most direct indicator

2. **`tado_control_mode` capability**
   - Values: `"AUTO"`, `"MANUAL"`, `"SCHEDULE"`
   - `"MANUAL"` indicates manual control is active

3. **Target temperature mismatch**
   - If `target_temperature` differs from scheduled target
   - May indicate recent manual adjustment
   - Not definitive (could be automation or away mode)

### Secondary Indicators

4. **Settings object**
   - Properties like `manualControl`, `allowManual`
   - Usually configuration rather than current state

5. **Store object**
   - Internal driver state
   - May track manual override timestamps
   - Look for `overlay`, `manualOverride`, `lastManualChange`

6. **Unknown properties**
   - Sometimes manual control info is in undocumented properties
   - Check Section 8 for any property containing "manual", "overlay", "mode"

## Common Scenarios

### Scenario 1: Overlay Capability Found
```
✓ tado_overlay
  Current value: true
  Type: boolean
```
**Interpretation:** Device is definitely in manual mode. The overlay is active.

### Scenario 2: Control Mode Found
```
✓ tado_control_mode
  Current value: MANUAL
  Type: enum
```
**Interpretation:** Device is set to manual control mode (not following schedule).

### Scenario 3: No Obvious Indicators
```
❌ No obvious overlay/manual/mode capabilities found
```
**Next Steps:**
- Check Section 6 (Store) for internal state
- Review Section 8 (All Properties) for undocumented properties
- Compare target temperature with schedule
- Check Tado app to see if manual mode is active there

### Scenario 4: Target Temperature Comparison
If you find that `target_temperature.value` is different from your schedule:
- Could be manual override
- Could be away mode adjustment
- Could be automation from another flow
- Check other indicators to confirm

## Integration with Heating System

The manual control detection is used in [`room_heating.js`](../room_heating.js):

### Current Implementation
```javascript
// Line 1076-1136: detectManualIntervention()
// Compares current target against last verified target
// Detects temperature changes by user
```

### Potential Enhancement
If `tado_overlay` capability exists:
```javascript
// Check overlay capability directly
const device = await Homey.devices.getDevice({ id: ROOM.heating.devices[0] });
const isManual = device.capabilitiesObj?.tado_overlay?.value === true;

if (isManual) {
    log('🤚 Manual control detected via overlay capability');
    activateManualOverrideMode('overlay', null, null);
}
```

## Troubleshooting

### Script Fails to Run
- **Check device ID:** Ensure `TADO_DEVICE_ID` is correct
- **Device availability:** Verify device is online in Homey
- **Permissions:** Ensure HomeyScript has access to devices

### No Manual Control Indicators Found
This could mean:
1. **Device doesn't expose overlay info** - Tado driver might not provide it
2. **Manual control is off** - Device is in auto/schedule mode
3. **Different property names** - Check unknown properties in Section 8

### Unexpected Property Values
- Some properties update slowly (cache)
- Try refreshing device in Homey app first
- Run script multiple times to see if values change

## Next Steps After Running Script

### If Manual Control Capability Found
1. **Document the property name** (e.g., `tado_overlay`)
2. **Note the value format** (boolean, enum, string)
3. **Test the capability:**
   ```javascript
   const device = await Homey.devices.getDevice({ id: TADO_DEVICE_ID });
   log(device.capabilitiesObj.tado_overlay?.value);
   ```
4. **Integrate into heating system** - Add to `detectManualIntervention()`

### If Manual Control NOT Found
1. **Check Tado app** - Verify if manual mode shows there
2. **Test manual adjustment:**
   - Set device to manual in Tado app
   - Run inspection script again
   - Compare before/after output
3. **Check API documentation** - Tado might expose this via their API
4. **Alternative detection:** Use temperature comparison method (current approach)

## Related Files

- **Main Script:** [`inspect_tado_properties.js`](../inspect_tado_properties.js)
- **Heating Control:** [`room_heating.js`](../room_heating.js) - Uses manual detection
- **Test Scripts:** [`test_tado_capabilities.js`](../test_tado_capabilities.js)
- **Configuration:** [`room_heating_config.js`](../room_heating_config.js)

## Technical Notes

### Device Object Structure
```javascript
{
  id: "device-uuid",
  name: "Device Name",
  capabilities: ["onoff", "target_temperature", ...],
  capabilitiesObj: {
    onoff: { id: "onoff", value: true, ... },
    target_temperature: { id: "target_temperature", value: 20, ... },
    tado_overlay: { id: "tado_overlay", value: false, ... } // <-- KEY PROPERTY
  },
  settings: { ... },  // Device configuration
  store: { ... },     // Internal driver state
  data: { ... }       // Device identifiers
}
```

### Capability Object Structure
```javascript
{
  id: "tado_overlay",
  value: true,           // Current state
  type: "boolean",
  title: "Manual Override",
  getable: true,
  setable: false,        // Usually read-only
  lastUpdated: "2026-01-19T08:00:00.000Z"
}
```

## Comparison with Existing Scripts

### [`test_tado_capabilities.js`](../test_tado_capabilities.js)
- **Focus:** Temperature sensor detection
- **Limited:** Shows capabilities but not comprehensive
- **Use case:** Finding temperature sensor

### [`inspect_tado_properties.js`](../inspect_tado_properties.js) (NEW)
- **Focus:** Complete property inspection + manual control
- **Comprehensive:** 10 sections covering all aspects
- **Use case:** Understanding full device structure and finding manual control

## Summary

The [`inspect_tado_properties.js`](../inspect_tado_properties.js) script provides a comprehensive inspection of Tado device properties with specific focus on identifying manual control indicators. Key things to check:

1. ✅ **Section 4** - Automated manual control detection
2. ✅ **Section 3** - `tado_overlay` or `tado_control_mode` capabilities
3. ✅ **Section 6** - Store object for internal state
4. ✅ **Section 8** - Unknown properties that might contain control info

The results will help determine if manual control can be directly detected from the device or if the current temperature-comparison method in [`room_heating.js`](../room_heating.js) is the best available approach.
