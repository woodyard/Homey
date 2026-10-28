/** Build "Parent > Child > Grandchild" path strings for every zone. */
export function buildZonePaths(zonesObj) {
  const paths = {};
  function pathFor(id, seen = new Set()) {
    if (paths[id]) return paths[id];
    const zone = zonesObj[id];
    if (!zone) return id;
    if (seen.has(id)) return zone.name; // guard against cycles
    seen.add(id);
    const path = zone.parent ? `${pathFor(zone.parent, seen)} > ${zone.name}` : zone.name;
    paths[id] = path;
    return path;
  }
  for (const id of Object.keys(zonesObj)) pathFor(id);
  return paths;
}

/**
 * Build a sortable "order key" for every zone: the chain of Homey `order` values
 * from the root zone down to the zone itself. Comparing these arrays reproduces
 * Homey's own hierarchical zone ordering (parent order first, then child order).
 */
export function buildZoneOrders(zonesObj) {
  const orders = {};
  function orderFor(id, seen = new Set()) {
    if (orders[id]) return orders[id];
    const zone = zonesObj[id];
    if (!zone) return [Infinity];
    const own = typeof zone.order === 'number' ? zone.order : 0;
    if (seen.has(id)) return [own]; // guard against cycles
    seen.add(id);
    const key = zone.parent ? [...orderFor(zone.parent, seen), own] : [own];
    orders[id] = key;
    return key;
  }
  for (const id of Object.keys(zonesObj)) orderFor(id);
  return orders;
}
