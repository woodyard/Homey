// The title Homey gives the current value of each enum capability (a robot vacuum's
// operational_state "66" → "Docked"), so the dashboard can show the device's own wording
// instead of a bare code. Capabilities without a value list are left out.
export function capLabels(capabilitiesObj) {
  const labels = {};
  for (const [capId, cap] of Object.entries(capabilitiesObj || {})) {
    if (!cap || !Array.isArray(cap.values)) continue;
    const hit = cap.values.find((v) => v && String(v.id) === String(cap.value));
    const title = hit ? hit.title : null;
    const text = title && typeof title === 'object' ? (title.da || title.en || Object.values(title)[0]) : title;
    if (text) labels[capId] = String(text);
  }
  return labels;
}
