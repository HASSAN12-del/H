const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.argv[2], V = path.join(SP, 'vendor');
const PAGE = 'http://127.0.0.1:8765/index.html';
const results = []; const ok = (name, cond, info='') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); };
async function routes(ctx){
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => {
    const p = new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '');
    r.fulfill({ path: path.join(V, 'package', p), contentType: 'application/javascript' });
  });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType:'text/css', body:
    [400,500,600].map(w=>`@font-face{font-family:'IBM Plex Sans Arabic';font-weight:${w};src:url(https://fonts.gstatic.com/plex${w}.woff2) format('woff2')}`).join('') +
    [500,700].map(w=>`@font-face{font-family:'Readex Pro';font-weight:${w};src:url(https://fonts.gstatic.com/readex${w}.woff2) format('woff2')}`).join('') }));
  await ctx.route('https://fonts.gstatic.com/**', r => {
    const u = r.request().url(); const m = u.match(/(plex|readex)(\d+)/);
    const f = m[1]==='plex' ? path.join(V,'f1/package/files',`ibm-plex-sans-arabic-arabic-${m[2]}-normal.woff2`) : path.join(V,'f2/package/files',`readex-pro-arabic-${m[2]}-normal.woff2`);
    r.fulfill({ path: f, contentType: 'font/woff2' });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport:{ width:1400, height:900 }, deviceScaleFactor:1 });
  await routes(ctx);
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE); await page.waitForFunction(() => window.app?.ready, null, { timeout: 30000 }); await sleep(1500);
  await page.screenshot({ path: path.join(SP,'s1_persp.png') });
  const checks = await page.evaluate(() => app.state.checks.map(c => [c.ok, c.title, c.detail]));
  ok('rule checks all pass', checks.every(c=>c[0]), checks.filter(c=>!c[0]).map(c=>c[1]).join(' | '));
  console.log('CHECKS:\n' + checks.map(c=>(c[0]?'✓ ':'✗ ')+c[1]+' — '+c[2]).join('\n'));
  ok('room table rows', (await page.locator('#roomTable tbody tr').count()) === 15);

  for (const [btn, key] of [['#tgFurn','furn'],['#tgDims','dims'],['#tgLabels','labels'],['#tgRoof','roof']]){
    const before = await page.evaluate(k => app.G[k].visible, key);
    await page.click(btn); const mid = await page.evaluate(k => app.G[k].visible, key);
    const pressed = await page.getAttribute(btn, 'aria-pressed');
    if (key==='furn') await page.screenshot({ path: path.join(SP,'s2_nofurn.png') });
    await page.click(btn); const after = await page.evaluate(k => app.G[k].visible, key);
    ok(`toggle ${key}`, before !== mid && after === before, `${before}->${mid}->${after} pressed=${pressed}`);
  }
  await page.click('#btnTop'); await sleep(1100);
  const camTop = await page.evaluate(() => [app.camera.position.y, app.camera.position.x]);
  ok('top view', camTop[0] > 20 && Math.abs(camTop[1]-1.1) < 0.01, JSON.stringify(camTop));
  await page.screenshot({ path: path.join(SP,'s3_top.png') });

  // measure living width at z=3 (world coords: x -6.25 .. -0.25)
  await page.click('#btnMeasure');
  ok('measure on', await page.evaluate(() => app.state.measure));
  const proj = await page.evaluate(() => { const c = document.getElementById('c').getBoundingClientRect();
    return [[-6.25,3-8.325],[-0.25,3-8.325]].map(([x,z]) => { const v = new app.camera.position.constructor(x,0.03,z).project(app.camera); return [c.left + (v.x+1)/2*c.width, c.top + (1-v.y)/2*c.height]; }); });
  await page.mouse.click(proj[0][0], proj[0][1]); await page.mouse.move(proj[1][0]-40, proj[1][1]); await page.mouse.click(proj[1][0], proj[1][1]);
  const m = await page.evaluate(() => app.measurements.slice());
  ok('measure living width = 6.00', m.length===1 && Math.abs(m[0]-6) < 0.051, JSON.stringify(m) + ' / ' + await page.textContent('#measureOut'));
  await page.screenshot({ path: path.join(SP,'s4_measure.png') });
  await page.click('#btnClearMeasure');
  ok('clear measure', await page.evaluate(() => app.G.measure.children.length===0 && app.measurements.length===0));
  await page.click('#btnMeasure'); ok('measure off', !(await page.evaluate(() => app.state.measure)));

  await page.click('#btnPersp'); await sleep(900);
  ok('persp view', await page.evaluate(() => app.state.view==='persp' && app.camera.position.z > 5));

  // sun
  await page.locator('#hour').fill('7');
  const sunInfo = await page.evaluate(() => [app.state.hour, document.getElementById('hourOut').textContent]);
  ok('hour slider', sunInfo[0]===7 && sunInfo[1]==='07:00', JSON.stringify(sunInfo));
  await sleep(300); await page.screenshot({ path: path.join(SP,'s5_morning.png') });
  await page.click('#btnNight');
  ok('night on', await page.evaluate(() => app.state.night && app.G.night.visible));
  await sleep(400); await page.screenshot({ path: path.join(SP,'s6_night.png') });
  await page.click('#btnNight');
  ok('night off', await page.evaluate(() => !app.state.night && !app.G.night.visible));
  await page.locator('#hour').fill('15');

  // colors
  await page.locator('#wallColor').fill('#c9b9a6');
  ok('wall color', await page.evaluate(() => app.G.walls.children[0].material[0].color.getHexString()) === 'c9b9a6');
  await page.click('#wallSw .sw:nth-child(3)');
  ok('wall swatch', await page.evaluate(() => app.G.walls.children[0].material[0].color.getHexString()) === 'd9e2e3');
  await page.selectOption('#floorTarget', 'master');
  await page.locator('#floorColor').fill('#9c7a58');
  const fc = await page.evaluate(() => Object.fromEntries(app.G.floors.children.map(f => [f.userData.room, f.material.color.getHexString()])));
  ok('floor color one room', fc.master==='9c7a58' && fc.living!=='9c7a58', JSON.stringify([fc.master, fc.living]));
  await page.selectOption('#floorTarget', 'dry'); await page.click('#floorSw .sw:nth-child(2)');
  const fc2 = await page.evaluate(() => Object.fromEntries(app.G.floors.children.map(f => [f.userData.room, f.material.color.getHexString()])));
  ok('floor swatch all dry', fc2.living==='efe9df' && fc2.master==='efe9df' && fc2.gbath!=='efe9df');

  // qibla
  await page.locator('#qibla').fill('0');
  ok('qibla 0 flags toilets', await page.evaluate(() => app.state.checks.some(c => !c.ok && c.title.includes('القبلة'))));
  await page.locator('#qibla').fill('244');
  ok('qibla 244 ok', await page.evaluate(() => app.state.checks.every(c => c.ok)));

  // table row focus
  const p0 = await page.evaluate(() => app.camera.position.toArray());
  await page.click('#roomTable tbody tr[data-room="majlis"]'); await sleep(900);
  const p1 = await page.evaluate(() => app.camera.position.toArray());
  ok('table row flies to room', Math.hypot(p0[0]-p1[0], p0[2]-p1[2]) > 1, JSON.stringify(p1.map(v=>+v.toFixed(2))));

  // walk
  await page.click('#btnWalk');
  ok('walk on', await page.evaluate(() => app.state.walk && !document.getElementById('walkPad').hidden));
  await page.keyboard.down('ArrowUp'); let last = null;
  for (let i=0;i<40;i++){ await sleep(1000); const x = await page.evaluate(() => app.camera.position.x); if (last!==null && Math.abs(x-last)<1e-4) break; last = x; }
  await page.keyboard.up('ArrowUp');
  const wp = await page.evaluate(() => app.camera.position.toArray());
  // entry hall world x range: 7.5-6.25=1.25 .. 6.25 ; z: 4.15-8.325 .. 6.55-8.325
  ok('walked through main door into entry hall, stopped by wall', wp[0] > 1.25 && wp[0] < 6.25 && wp[2] > -4.2 && wp[2] < -1.8, JSON.stringify(wp.map(v=>+v.toFixed(2))));
  await page.screenshot({ path: path.join(SP,'s7_walk_entry.png') });
  // turn left via pad (hold) then mouse-drag look
  const yaw0 = await page.evaluate(() => app.camera.rotation.y);
  const pad = await page.locator('#wpL').boundingBox();
  await page.mouse.move(pad.x+20, pad.y+20); await page.mouse.down(); await sleep(2500); await page.mouse.up();
  const yaw1 = await page.evaluate(() => app.camera.rotation.y);
  ok('walk pad turn', Math.abs(yaw1-yaw0) > 0.5, `${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);
  await page.mouse.move(700,450); await page.mouse.down(); await page.mouse.move(800,450,{steps:5}); await page.mouse.up();
  const yaw2 = await page.evaluate(() => app.camera.rotation.y);
  ok('drag to look', Math.abs(yaw2-yaw1) > 0.3);
  // go into the majlis: face south and walk through lobby & door
  await page.evaluate(() => { app.camera.position.set(8.25-6.25, 1.6, 5.5-8.325); });
  await page.evaluate(() => {}); 
  await page.keyboard.press('Escape');
  ok('Esc exits walk', await page.evaluate(() => !app.state.walk && document.getElementById('walkPad').hidden));
  await page.click('#btnWalk'); await page.click('#btnExitWalk');
  ok('exit button', await page.evaluate(() => !app.state.walk && app.G.labels.visible && app.G.dims.visible));

  // walk inside: start in family corridor, go south to master suite
  await page.click('#btnWalk');
  await page.evaluate(() => { app.camera.position.set(6.75-6.25, 1.6, 5-8.325); });
  // face south: yaw = PI
  await page.evaluate(() => app.look(Math.PI));
  await page.keyboard.down('KeyS'); await sleep(200); await page.keyboard.up('KeyS'); // ensure keys work
  await sleep(500); await page.screenshot({ path: path.join(SP,'s8_walk_corridor.png') });
  await page.evaluate(() => { app.walkTo(10-6.25, 10.3-8.325); app.look(Math.PI*0.97, -0.05); }); await sleep(600);
  await page.screenshot({ path: path.join(SP,'s8b_walk_majlis.png') });
  await page.evaluate(() => { app.walkTo(4.6-6.25, 12.0-8.325); app.look(Math.PI*0.8, -0.15); }); await sleep(600);
  await page.screenshot({ path: path.join(SP,'s8c_walk_master.png') });
  await page.keyboard.press('Escape');

  await page.click('#btnPanel');
  ok('panel hide', await page.evaluate(() => document.getElementById('app').classList.contains('nopanel')));
  await page.click('#btnPanel');
  ok('panel show', await page.evaluate(() => !document.getElementById('app').classList.contains('nopanel')));
  await page.click('#changes summary'); ok('changes details opens', await page.evaluate(() => document.getElementById('changes').open));

  // mobile
  const m2 = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:1, hasTouch:true });
  await routes(m2); const mp = await m2.newPage();
  mp.on('pageerror', e => errors.push('mobile: '+e));
  await mp.goto(PAGE); await mp.waitForFunction(() => window.app?.ready); await sleep(1500);
  await mp.screenshot({ path: path.join(SP,'s9_mobile.png') });
  const ovf = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById('panel').scrollWidth > document.getElementById('panel').clientWidth);
  ok('mobile no horizontal overflow', !ovf);
  await mp.click('#btnTop'); await sleep(900); await mp.screenshot({ path: path.join(SP,'s10_mobile_top.png') });
  await mp.click('#btnWalk'); ok('mobile walk', await mp.evaluate(() => app.state.walk));
  await mp.screenshot({ path: path.join(SP,'s11_mobile_walk.png') });

  ok('no console errors', errors.length===0, errors.join(' || '));
  console.log(results.map(r=>r.join(' | ')).join('\n'));
  console.log(`\n${results.filter(r=>r[0]==='PASS').length}/${results.length} passed`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
