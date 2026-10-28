import { readSession } from '../../../../lib/sessionCookie';
import { homeyFetch } from '../../../../lib/homey';
import { buildZonePaths, buildZoneOrders } from '../../../../lib/zones';

// Server-Sent Events stream of live device changes. A persistent server (the NAS
// deployment) polls Homey quickly and pushes only the devices whose capability
// values changed, so the browser updates within a couple of seconds without
// re-fetching everything. Requires a long-lived process — not Vercel's serverless
// functions — which is why the client only opens this when NEXT_PUBLIC_LIVE=1.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_MS = 2500;

export async function GET(request) {
  const session = readSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let interval = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const snapshot = {}; // deviceId -> JSON of capability values
      const notifSeen = new Set();
      let notifSeeded = false;
      let ticks = 0;

      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller closed */ }
      };

      const tick = async () => {
        if (closed) return;
        try {
          const [devicesObj, zonesObj] = await Promise.all([
            homeyFetch(session, '/api/manager/devices/device'),
            homeyFetch(session, '/api/manager/zones/zone'),
          ]);
          const zonePaths = buildZonePaths(zonesObj);
          const zoneOrders = buildZoneOrders(zonesObj);
          const changed = [];
          for (const d of Object.values(devicesObj)) {
            if (d.group) continue; // skip group members; the group device represents them
            const capabilities = {};
            const capTimes = {};
            for (const [capId, cap] of Object.entries(d.capabilitiesObj || {})) {
              capabilities[capId] = cap ? cap.value : null;
              if (cap && cap.lastUpdated && (capId === 'alarm_motion' || capId === 'alarm_contact')) {
                capTimes[capId] = cap.lastUpdated;
              }
            }
            const sig = JSON.stringify(capabilities);
            if (snapshot[d.id] !== sig) {
              snapshot[d.id] = sig;
              changed.push({
                id: d.id,
                name: d.name,
                class: d.class,
                virtualClass: d.virtualClass || null,
                zoneId: d.zone,
                zonePath: zonePaths[d.zone] || d.zone,
                zoneOrder: zoneOrders[d.zone] || [Infinity],
                available: d.available,
                alwaysOn: !!(d.settings && d.settings.energy_alwayson),
                capabilities,
                capTimes,
              });
            }
          }
          if (changed.length) send('devices', { devices: changed });
          else send('ping', {}); // keep the connection (and any proxies) alive
        } catch (e) {
          send('sse-error', { error: String(e.message || e) });
        }

        // Poll Timeline notifications less often (~every 10s). Seed silently the
        // first time, then push only newly-arrived notifications.
        ticks += 1;
        if (ticks % 4 === 1) {
          try {
            const notifObj = await homeyFetch(session, '/api/manager/notifications/notification');
            const fresh = [];
            for (const n of Object.values(notifObj || {})) {
              if (!notifSeen.has(n.id)) {
                notifSeen.add(n.id);
                fresh.push({ id: n.id, excerpt: n.excerpt, dateCreated: n.dateCreated, ownerName: n.ownerName || null });
              }
            }
            if (notifSeeded && fresh.length) send('notifications', { notifications: fresh });
            notifSeeded = true;
          } catch { /* notifications are best-effort */ }
        }
      };

      send('ready', { ok: true });
      tick();
      interval = setInterval(tick, POLL_MS);

      request.signal.addEventListener('abort', () => {
        closed = true;
        if (interval) clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tell nginx (Synology reverse proxy) not to buffer the stream, so events
      // reach the browser immediately instead of being batched.
      'X-Accel-Buffering': 'no',
    },
  });
}
