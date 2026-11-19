// The title Homey gives the current value of each enum capability (a robot vacuum's
// operational_state "66" → "Docked"), so the dashboard can show the device's own wording
// instead of a bare code. Capabilities without a value list are left out.
const titleText = (title) => {
  const text = title && typeof title === 'object' ? (title.da || title.en || Object.values(title)[0]) : title;
  return text ? String(text) : '';
};

export function capLabels(capabilitiesObj) {
  const labels = {};
  for (const [capId, cap] of Object.entries(capabilitiesObj || {})) {
    if (!cap || !Array.isArray(cap.values)) continue;
    const hit = cap.values.find((v) => v && String(v.id) === String(cap.value));
    const text = hit ? titleText(hit.title) : '';
    if (text) labels[capId] = text;
  }
  return labels;
}

// The capabilities the dashboard offers a picker for: every value they can be set to, with
// Homey's title (a robot vacuum's clean mode: vacuum, mop, both, …). A capability that cannot
// be set, or has no value list, is left out, and then no picker is shown.
export const CHOICE_CAPS = ['vacuumcleaner_job_mode.clean_mode'];

export function capChoices(capabilitiesObj) {
  const choices = {};
  for (const capId of CHOICE_CAPS) {
    const cap = (capabilitiesObj || {})[capId];
    if (!cap || cap.setable === false || !Array.isArray(cap.values)) continue;
    const list = cap.values
      .filter((v) => v && v.id != null)
      .map((v) => ({ id: String(v.id), label: titleText(v.title) || String(v.id) }));
    if (list.length) choices[capId] = list;
  }
  return choices;
}
