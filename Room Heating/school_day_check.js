/**
 * School Day Check Script
 *
 * Directly queries Clara's school calendar feed and sets:
 * - IsSchoolDay: true if there are events today
 * - IsSchoolDayTomorrow: true if there are events tomorrow
 *
 * Usage: Run this script from a flow at 00:05, 06:00, etc.
 *
 * Author: Henrik Skovgaard
 * Version: 1.0.0
 * Created: 2026-01-23
 */

const CALENDAR_URL = 'https://nsg.m.skoleintra.dk/feed/schedule/v1?type=Schedule&unifiedId=366903&culture=da-DK&hash=79e59b9f779667ab7dbc022cd4918ab9';

// Variable IDs from Homey Logic
const VAR_IS_SCHOOL_DAY = '176a1597-9d52-47e4-ac16-b60359c5be46';
const VAR_IS_SCHOOL_DAY_TOMORROW = 'd3b16e28-746b-4168-a6bb-6651da7c8608';

/**
 * Get Danish local date (YYYY-MM-DD format)
 */
function getDanishDate(offsetDays = 0) {
    const now = new Date();
    const danish = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
    danish.setDate(danish.getDate() + offsetDays);

    const year = danish.getFullYear();
    const month = String(danish.getMonth() + 1).padStart(2, '0');
    const day = String(danish.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
}

/**
 * Parse iCal DTSTART to date string (YYYYMMDD)
 * Handles both UTC (Z suffix) and local time formats
 */
function parseIcalDate(dtstart) {
    // DTSTART format: 20260121T090000Z or 20260121T090000
    // Extract just the date part (first 8 characters)
    return dtstart.substring(0, 8);
}

/**
 * Check if calendar has events on a specific date
 */
function hasEventsOnDate(icalData, dateStr) {
    // Find all DTSTART entries
    const lines = icalData.split('\n');

    for (const line of lines) {
        if (line.startsWith('DTSTART:') || line.startsWith('DTSTART;')) {
            // Extract the date value
            const value = line.includes(':') ? line.split(':')[1].trim() : '';
            const eventDate = parseIcalDate(value);

            if (eventDate === dateStr) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Set a Homey Logic variable by ID
 */
async function setVariable(variableId, value) {
    try {
        await Homey.logic.updateVariable({
            id: variableId,
            variable: { value: value }
        });
        return true;
    } catch (error) {
        log(`⚠️ Could not set variable ${variableId}: ${error.message}`);
        return false;
    }
}

/**
 * Send notification
 */
async function notify(message) {
    try {
        await Homey.flow.runFlowCardAction({
            uri: "homey:flowcardaction:homey:manager:notifications:create_notification",
            id: "homey:manager:notifications:create_notification",
            args: { text: message }
        });
    } catch (error) {
        log(`⚠️ Could not send notification: ${error.message}`);
    }
}

// ============================================================================
// Main Execution
// ============================================================================

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║              SCHOOL DAY CHECK                                  ║');
log('╚═══════════════════════════════════════════════════════════════╝\n');

// Get today and tomorrow dates in Danish timezone
const todayStr = getDanishDate(0);
const tomorrowStr = getDanishDate(1);

log(`📅 Today: ${todayStr}`);
log(`📅 Tomorrow: ${tomorrowStr}`);

// Fetch calendar feed
log(`\n🌐 Fetching calendar from Skoleintra...`);

let icalData;
try {
    const response = await fetch(CALENDAR_URL);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    icalData = await response.text();
    log(`✅ Calendar fetched (${icalData.length} bytes)`);
} catch (error) {
    log(`❌ Failed to fetch calendar: ${error.message}`);
    // Don't change variables if we can't fetch the calendar
    return;
}

// Check for events today and tomorrow
const hasEventsToday = hasEventsOnDate(icalData, todayStr);
const hasEventsTomorrow = hasEventsOnDate(icalData, tomorrowStr);

log(`\n📊 Results:`);
log(`   Today (${todayStr}): ${hasEventsToday ? '✅ SCHOOL DAY' : '❌ No school'}`);
log(`   Tomorrow (${tomorrowStr}): ${hasEventsTomorrow ? '✅ SCHOOL DAY' : '❌ No school'}`);

// Get current variable values to detect changes
let currentIsSchoolDay = null;
let currentIsSchoolDayTomorrow = null;

try {
    const variables = await Homey.logic.getVariables();
    for (const [id, variable] of Object.entries(variables)) {
        if (variable.name === 'IsSchoolDay') {
            currentIsSchoolDay = variable.value;
        }
        if (variable.name === 'IsSchoolDayTomorrow') {
            currentIsSchoolDayTomorrow = variable.value;
        }
    }
} catch (error) {
    log(`⚠️ Could not read current variables: ${error.message}`);
}

// Set variables
log(`\n⚙️ Updating Homey Logic variables...`);

const todayChanged = currentIsSchoolDay !== hasEventsToday;
const tomorrowChanged = currentIsSchoolDayTomorrow !== hasEventsTomorrow;

await setVariable(VAR_IS_SCHOOL_DAY, hasEventsToday);
log(`   IsSchoolDay = ${hasEventsToday}${todayChanged ? ' (changed!)' : ''}`);

await setVariable(VAR_IS_SCHOOL_DAY_TOMORROW, hasEventsTomorrow);
log(`   IsSchoolDayTomorrow = ${hasEventsTomorrow}${tomorrowChanged ? ' (changed!)' : ''}`);

// Send notification if anything changed
if (todayChanged || tomorrowChanged) {
    const changes = [];
    if (todayChanged) {
        changes.push(`Today: ${hasEventsToday ? 'School' : 'Free'}`);
    }
    if (tomorrowChanged) {
        changes.push(`Tomorrow: ${hasEventsTomorrow ? 'School' : 'Free'}`);
    }

    await notify(`📚 School Calendar Updated\n${changes.join('\n')}`);
    log(`\n📢 Notification sent (changes detected)`);
} else {
    log(`\n✓ No changes - no notification needed`);
}

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║              SCHOOL DAY CHECK COMPLETE                         ║');
log('╚═══════════════════════════════════════════════════════════════╝');
