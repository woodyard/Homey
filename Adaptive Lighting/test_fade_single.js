// Test Fade Script - Hardware Fade via Flow Card
// Tests hardware fade on SV Loft group members individually
//
// Key finding: The GROUP device (SV Loft) has duration:false on its dim card,
// but the INDIVIDUAL members (SV Loft 1/2/3) have duration:true.
// So we must run the flow card on each member, not the group.

const GROUP_ID = "cbbd7c60-dc84-43c7-8f0f-790556fc9b14"; // SV Loft (group)
const FADE_DURATION = 30; // seconds

const group = await Homey.devices.getDevice({ id: GROUP_ID });
log(`Group: ${group.name}`);
log(`Current: dim=${Math.round((group.capabilitiesObj?.dim?.value || 0) * 100)}%`);

// Find group members
const allDevices = await Homey.devices.getDevices();
const members = Object.values(allDevices).filter(d =>
  d.name.startsWith(group.name + ' ') && d.name !== group.name && d.class === 'light'
);

log(`Found ${members.length} members: ${members.map(m => m.name).join(', ')}`);

if (members.length === 0) {
  return 'ERROR: No group members found';
}

// If group is off, turn it on first
const currentDim = group.capabilitiesObj?.dim?.value || 0;
if (currentDim <= 0.01) {
  log(`Group is off — turning on to 60%...`);
  await group.setCapabilityValue('onoff', true);
  await group.setCapabilityValue('dim', 0.6);
  // Busy-wait for bulbs to respond
  const end = Date.now() + 2000;
  while (Date.now() < end) {}
  log(`Group turned on`);
}

// Run hardware fade on each member via flow card action
log(`\nStarting ${FADE_DURATION}s HARDWARE fade on ${members.length} members...`);

const results = [];
for (const member of members) {
  const cardId = `homey:device:${member.id}:dim`;
  try {
    await Homey.flow.runFlowCardAction({
      uri: `homey:device:${member.id}`,
      id: cardId,
      args: { dim: 0 },
      duration: FADE_DURATION
    });
    log(`  ${member.name}: hardware fade started`);
    results.push({ name: member.name, ok: true });
  } catch (e) {
    log(`  ${member.name}: FAILED - ${e.message}`);
    results.push({ name: member.name, ok: false, error: e.message });
  }
}

const ok = results.filter(r => r.ok).length;
log(`\nDone! ${ok}/${members.length} members fading via hardware over ${FADE_DURATION}s`);
log(`Script exits immediately — bulbs handle the fade themselves`);

return `${group.name}: Hardware fade started on ${ok}/${members.length} members (${FADE_DURATION}s)`;
