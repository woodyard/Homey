import fs from 'node:fs';
const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const zone = Object.keys(j.globals).find(k => k.endsWith('.Heating.State'));
  const st = zone ? j.globals[zone] : null;
  const action = Object.entries(j.globals).find(([k]) => k.endsWith('.Heating.LastAction'))?.[1];
  const cmds = j.commands.map(c => `${c.device.replace(/^(C |Skovgaard \/ )/, '')}:${c.capability === 'onoff' ? (c.value ? 'ON' : 'OFF') : c.value}`).join(',');
  const notif = j.notifications.map(n => n.split('\n')[1]).join(' || ');
  console.log(`${j.scenario.padEnd(32)} ${j.thrown ? 'THROWN: ' + j.thrown.slice(0, 40) : ''}mode=${st?.mode ?? '-'}(${st?.modeExpires ?? ''}) act=${action ?? '-'} cmds=[${cmds}] notif=[${notif}]`);
}
