// Timings at phone speed: loads the site with the processor slowed down (6x by default, about a mid-range phone)
// and times what students wait for: the first load, routes on campus and between campuses, a re-route mid-walk,
// and Find nearby. A measurement, not a pass/fail check.
//
// Usage (from this folder, with the preview server running on port 8765: python3 scripts/serve.py 8765):
//   npm run perf          or   npm run perf -- 4   (4x slower)
import { chromium } from 'playwright';
const RATE = Number(process.argv[2] || 6);
// The city sidewalks are prepared in the background a few seconds after load: wait for that, as a student would
const browser=await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx=await browser.newContext({viewport:{width:390,height:844}, geolocation:{longitude:-71.1703,latitude:42.3356}, permissions:['geolocation'], timezoneId:'America/New_York'});
await ctx.addInitScript(()=>{localStorage.setItem('accessbc.settings',JSON.stringify({guidance3D:false,headingUp:false,reduceMotion:true})); localStorage.setItem('accessbc.liveDirectionsNotice','understood');});
const p=await ctx.newPage(); p.setDefaultTimeout(240000);
await p.clock.install({ time: new Date('2026-10-21T14:00:00Z') }); await p.clock.resume();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
const t0 = Date.now();
await p.goto('http://localhost:8765/');
await p.waitForFunction(()=>typeof routing!=='undefined'&&routing);
const tRouting = Date.now() - t0;
await p.waitForFunction(()=>routePoints);
const tPoints = Date.now() - t0;
await p.waitForFunction(() => routing.graphs.city && routing.graphs.city.grades, null, { timeout: 120000 });
const tCity = Date.now() - t0;
const time = (label, fn) => p.evaluate(fn).then((r) => console.log(label.padEnd(44), `${r} ms`));
console.log(`CPU ${RATE}x slower`);
console.log('page load → routing ready'.padEnd(44), `${tRouting} ms`);
console.log('page load → map data ready'.padEnd(44), `${tPoints} ms`);
console.log('page load → city sidewalks ready (background)'.padEnd(44), `${tCity} ms`);
const route = (from, to) => `async () => { const t=performance.now(); document.getElementById('route-from').value=${JSON.stringify(from)}; routing.fromChosen=true; document.getElementById('route-to').value=${JSON.stringify(to)}; await updateRoute(map); return Math.round(performance.now()-t); }`;
await time('first campus route (Gasson → McElroy)', `(${route('Gasson Hall','McElroy Commons')})()`);
await time('same route again', `(${route('Gasson Hall','McElroy Commons')})()`);
await time('first between-campus route (→ Kenny Cottle)', `(${route('Gasson Hall','Kenny Cottle Library')})()`);
await time('same route again', `(${route('Gasson Hall','Kenny Cottle Library')})()`);
await time('another city route (Gasson → Murray House)', `(${route('Gasson Hall','Murray House')})()`);
await time('re-route from here, mid-walk', `(async()=>{ await updateRoute(map); await startGuidance(map,{follow:true}); const t=performance.now(); rerouteFromHere(map,{automatic:true}); await new Promise(r=>{ const c=()=> guide.active && routing.current ? r() : setTimeout(c,20); setTimeout(c,50); }); stopGuidance(map); return Math.round(performance.now()-t); })()`);
await time('Find nearby restrooms (from you)', `(async()=>{ const t=performance.now(); document.getElementById('nearby-kind').value='restroom'; fillNearbyFrom(); document.getElementById('nearby-from').value='me'; await findNearby(map); return Math.round(performance.now()-t); })()`);
await time('Find nearby T stations', `(async()=>{ const t=performance.now(); document.getElementById('nearby-kind').value='tstation'; fillNearbyFrom(); document.getElementById('nearby-from').value='me'; await findNearby(map); return Math.round(performance.now()-t); })()`);
await browser.close();
