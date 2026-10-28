import { NextResponse } from 'next/server';
import { readSession, persistSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';
import { buildZonePaths } from '../../../../lib/zones';
import { HEATING_ROOMS } from '../../../../lib/heating';

// Heating-output logs used by the Rooms 2.0 forecast model: the tado valve's
// target + heating power, and the smart plugs' power draw in plug-heated rooms.
const HEATING_DEVICE_IDS = new Set(HEATING_ROOMS.flatMap((r) => [r.thermostatId, ...(r.plugIds || [])].filter(Boolean)));
const HEATING_CAPS = new Set(['target_temperature', 'tado_heating_power', 'energy_power']);

const PERIODS = new Set(['last6Hours', 'last24Hours', 'last7Days', 'last14Days', 'last31Days']);
const MAX_SELECTED_LOGS = 40;

// Newer Homey firmware identifies an insights log by one composite id
// ("homey:device:<deviceId>:<capabilityId>"); older firmware used a separate
// uri ("homey:device:<deviceId>") + bare capability id. Support both.
const COMPOSITE_RX = /^homey:device:([0-9a-fA-F-]{36}):(.+)$/;

function asList(value) {
  if (Array.isArray(value)) return value;
  return Object.values(value || {});
}

// Normalise a raw log object to { uri, capId, rawId, deviceId } for either format.
function normalizeLog(log) {
  const rawId = String(log.id || '');
  const composite = COMPOSITE_RX.exec(rawId);
  if (composite) {
    return {
      rawId,
      deviceId: composite[1],
      capId: composite[2],
      uri: log.uri || `homey:device:${composite[1]}`,
    };
  }
  const uri = String(log.uri || '');
  const uriMatch = /^homey:device:([0-9a-fA-F-]{36})$/.exec(uri);
  return {
    rawId,
    deviceId: uriMatch ? uriMatch[1] : (log.ownerId || null),
    capId: rawId,
    uri: log.uri || null,
  };
}

function isTemperatureCap(capId) {
  return capId === 'measure_temperature' || capId === 'measure_temperature.outside';
}

export async function GET(request) {
  const session = readSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedPeriod = searchParams.get('period') || 'last7Days';
  const period = PERIODS.has(requestedPeriod) ? requestedPeriod : 'last7Days';
  const requestedKeys = (searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, MAX_SELECTED_LOGS);

  try {
    const [logsObj, devicesObj, zonesObj] = await Promise.all([
      homeyFetch(session, '/api/manager/insights/log'),
      homeyFetch(session, '/api/manager/devices/device'),
      homeyFetch(session, '/api/manager/zones/zone'),
    ]);
    const zonePaths = buildZonePaths(zonesObj);
    const devices = devicesObj || {};

    const sensors = asList(logsObj)
      .map((log) => ({ log, norm: normalizeLog(log) }))
      .filter(({ log, norm }) => log && log.type === 'number' && log.units === '°C' && isTemperatureCap(norm.capId))
      .filter(({ norm }) => {
        // Exclude logs whose device is gone or marked unavailable (non-responsive),
        // and "system" devices whose measure_temperature is really a CPU temperature
        // (recognisable by sibling capabilities like CPU cores / load / memory).
        const device = devices[norm.deviceId];
        if (!device || device.available === false) return false;
        const capIds = Object.keys(device.capabilitiesObj || {});
        const isSystemDevice = capIds.some((c) => (
          c === 'measure_cores' || c.startsWith('measure_loadavg') || c.startsWith('measure_mem')
          || c.startsWith('measure_storage') || c.startsWith('measure_coreClock')
        ));
        if (isSystemDevice) return false;
        // Honour the device's "Exclude from climate" setting. The exact key isn't
        // documented, so check the plausible locations/spellings — absent keys are
        // simply falsy.
        const opt = (device.capabilitiesOptions || {})[norm.capId] || {};
        const st = device.settings || {};
        // Confirmed key on this firmware (via devices-debug): settings.climate_exclude.
        const climateExcluded = st.climate_exclude === true
          || device.excludeClimate === true || device.climateExcluded === true
          || device.excludedFromClimate === true
          || opt.excludeClimate === true || opt.climateExcluded === true
          || st.excludeClimate === true || st.climateExcluded === true
          || st.exclude_from_climate === true;
        return !climateExcluded;
      })
      .map(({ log, norm }) => {
        const device = devices[norm.deviceId] || {};
        return {
          key: `${norm.uri}::${norm.capId}`,
          uri: norm.uri,
          logId: norm.capId,
          rawId: norm.rawId,
          deviceId: norm.deviceId,
          name: device.name || log.ownerName || log.title || norm.capId,
          zone: zonePaths[device.zone] || device.zoneName || '',
          latest: typeof log.lastValue === 'number' ? log.lastValue : null,
          units: log.units,
        };
      })
      .sort((a, b) => {
        const zoneCmp = (a.zone || '').localeCompare(b.zone || '', 'da');
        return zoneCmp || a.name.localeCompare(b.name, 'da');
      });

    const heating = asList(logsObj)
      .map((log) => ({ log, norm: normalizeLog(log) }))
      .filter(({ log, norm }) => log && log.type === 'number' && HEATING_CAPS.has(norm.capId) && HEATING_DEVICE_IDS.has(norm.deviceId))
      .map(({ log, norm }) => {
        const device = devices[norm.deviceId] || {};
        return {
          key: `${norm.uri}::${norm.capId}`,
          uri: norm.uri,
          logId: norm.capId,
          rawId: norm.rawId,
          deviceId: norm.deviceId,
          name: device.name || log.ownerName || log.title || norm.capId,
          units: log.units,
        };
      });

    const byKey = new Map([...sensors, ...heating].map((sensor) => [sensor.key, sensor]));
    const selected = requestedKeys.map((key) => byKey.get(key)).filter(Boolean);

    // Fetch each log independently — one broken/stale log must not fail the whole
    // request. Try the composite-id endpoint first (current firmware), then the
    // legacy uri + capability form.
    const series = await Promise.all(selected.map(async (sensor) => {
      // Per Athom's own homey-api client (v3): GET /log/:uri/:id/entry where :uri is
      // "homey:device:<deviceId>" and :id is the FULL composite log id. Older firmware
      // used the bare capability id as :id — kept as fallback.
      const paths = [];
      if (COMPOSITE_RX.test(sensor.rawId)) {
        paths.push(`/api/manager/insights/log/${encodeURIComponent(sensor.uri)}/${encodeURIComponent(sensor.rawId)}/entry?resolution=${encodeURIComponent(period)}`);
      }
      paths.push(`/api/manager/insights/log/${encodeURIComponent(sensor.uri)}/${encodeURIComponent(sensor.logId)}/entry?resolution=${encodeURIComponent(period)}`);
      for (const path of paths) {
        try {
          const entriesObj = await homeyFetch(session, path);
          // Known response shapes across firmware versions: a bare array of {t,v},
          // or an object carrying the samples under `entries` or `values`.
          const raw = Array.isArray(entriesObj) ? entriesObj
            : Array.isArray(entriesObj && entriesObj.entries) ? entriesObj.entries
              : Array.isArray(entriesObj && entriesObj.values) ? entriesObj.values
                : asList(entriesObj);
          const entries = raw
            .filter((entry) => entry && typeof entry.v === 'number' && entry.t)
            .map((entry) => ({ t: entry.t, v: entry.v }));
          // Empty may mean "wrong endpoint shape answered politely" — try the next
          // form before accepting an empty result.
          if (entries.length) return { key: sensor.key, entries };
        } catch { /* try the next form */ }
      }
      return { key: sensor.key, entries: [] };
    }));

    const res = NextResponse.json({ period, sensors, heating, series });
    persistSession(res, session);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
