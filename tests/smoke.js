// Smoke and behaviour tests for the hub. Run from the repo root:  node tests/smoke.js
// Uses Playwright's Chromium, a stubbed Supabase client (tests/stub-supabase.js) and a fixed clock.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const STUB=fs.readFileSync(path.join(__dirname,'stub-supabase.js'),'utf8');
const NOW=new Date('2026-11-04T19:00:00');
const SEED=[
  {coll:'settings',id:'curriculum',data:{v:2}},
  {coll:'settings',id:'plan',data:{order:['quant','econ','corp','fsa','equity','fi','deriv','alts','pm','ethics'],weeks:{quant:1,econ:2,corp:1,fsa:5,equity:2,fi:3,deriv:2,alts:1,pm:1,ethics:2}}},
  {coll:'modules',id:'quant',data:{items:[{id:'q1',name:'Returns of Financial Assets and Instruments',est:127,done:true,doneOn:'2026-11-02',rating:3},{id:'q2',name:'Types of Financial Returns',est:86,done:false}]}},
];
// The live site's headers (including the Content-Security-Policy), so a blocked resource shows up here too.
const HEADERS=Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8')).headers[0].headers.map(h=>[h.key,h.value]));
let failures=0;
const check=(ok,msg)=>{console.log((ok?'  ok   ':'  FAIL ')+msg);if(!ok)failures++};

async function open(browser,{width=1280,seed=SEED}={}){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  const page=await ctx.newPage();
  page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))page.errors.push('CSP: '+m.text())});
  await page.clock.install({time:NOW});
  await ctx.route('**/*',r=>{const u=r.request().url();
    if(u.includes('cdn.jsdelivr.net'))return r.fulfill({body:STUB,contentType:'application/javascript'});
    if(u.startsWith('http://hub.test/')){
      const f=path.join(ROOT,new URL(u).pathname.slice(1)||'index.html');let body=fs.readFileSync(f);
      if(f.endsWith('.html'))body=String(body).replace(/ integrity="[^"]+"/,'');
      return r.fulfill({body,contentType:f.endsWith('.js')?'application/javascript':'text/html',headers:HEADERS})}
    return r.abort()});
  await page.addInitScript(rows=>{if(!localStorage.getItem('__stubdb')){localStorage.setItem('__stubdb',JSON.stringify(rows));localStorage.setItem('cfa-trusted','1')}},seed);
  await page.goto('http://hub.test/index.html');
  await page.waitForFunction(()=>document.querySelector('#sync')?.textContent.startsWith('Synced'));
  return page;
}
const go=async(page,v)=>{await page.evaluate(v=>location.hash=v,v);await page.waitForTimeout(100)};
const db=(page,c)=>page.evaluate(c=>window.__db.find(c),c);
const toEnd=async page=>{for(let i=0;i<10&&await page.$('[data-act=nextstep]');i++){await page.click('[data-act=nextstep]');await page.waitForTimeout(30)}};
const toastText=page=>page.evaluate(()=>document.querySelector('#toast').textContent);
async function runToFinish(page,tpl){
  await go(page,'session');
  await page.click(`[data-act=tpl][data-k=${tpl}]`);
  await page.click('[data-act=begin]');
  for(let i=0;i<10&&await page.$('[data-act=nextstep]');i++){await page.click('[data-act=nextstep]');await page.waitForTimeout(30)}
}

(async()=>{
  const browser=await chromium.launch();

  console.log('Every view renders at 1280px and 400px');
  for(const width of [1280,400]){
    const page=await open(browser,{width});
    for(const v of ['today','progress','session','plan','cards','mistakes','notes']){
      await go(page,v);
      const over=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      check(over<=0,`${v} at ${width}px has no sideways scroll (${over})`);
    }
    check(!page.errors.length,`no page errors at ${width}px ${page.errors.join(' | ')}`);
    await page.context().close();
  }

  console.log('A session saved offline is kept and synced later (1, 2)');
  {
    const page=await open(browser);
    await runToFinish(page,'module');
    await page.evaluate(()=>__db.setFail('network'));
    await page.click('[data-act=savesession]');await page.waitForTimeout(200);
    check(/kept on this device/.test(await toastText(page)),'tells you it is kept on this device');
    check((await db(page,'sessions')).length===0,'nothing reached the database yet');
    check(await page.evaluate(()=>JSON.parse(localStorage.getItem('cfa-hub-outbox')||'[]').some(o=>o.c==='sessions')),'session waits in the outbox');
    check(/not saved yet/.test(await page.textContent('#sync')),'sync line says changes are not saved');
    await page.evaluate(()=>__db.setFail(null));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#sync')?.textContent.startsWith('Synced'));
    check((await db(page,'sessions')).length===1,'after reconnecting the session is in the database');
    check((await db(page,'modules')).find(r=>r.id==='quant').data.items.find(m=>m.id==='q2').done===true,'module tick saved too');
    await page.context().close();
  }

  console.log('Mixed quiz scores stay out of topic averages; mocks become mock scores (3)');
  {
    const page=await open(browser);
    await go(page,'session');await page.click('[data-act=tpl][data-k=mixed]');
    check(!(await page.$('#sModSel')),'no module picker for a mixed set');
    await page.click('[data-act=begin]');await page.click('[data-act=nextstep]');
    check(await page.inputValue('select[id^=q_t_]')==='mixed','quiz topic defaults to Mixed');
    await page.fill('input[id^=q_c_]','30');await page.fill('input[id^=q_n_]','40');
    await toEnd(page);await page.click('[data-act=savesession]');await page.waitForTimeout(100);
    check(await page.evaluate(()=>topicQuiz('quant').length===0),'quant average ignores the mixed set');
    await runToFinish(page,'mock');
    check(!(await page.$('.rate-big')),'no module rating after a mock');
    await page.click('[data-act=backto]');
    await page.fill('input[id^=q_c_]','130');await page.fill('input[id^=q_n_]','180');
    await toEnd(page);
    await page.click('[data-act=savesession]');await page.waitForTimeout(100);
    const sc=await db(page,'scores');
    check(sc.length===1&&sc[0].data.type==='mock'&&sc[0].data.pct===72,'mock saved as one 72% mock score');
    await page.context().close();
  }

  console.log('Impossible quiz scores are refused (8)');
  {
    const page=await open(browser);
    await go(page,'session');await page.click('[data-act=begin]');
    await page.click('[data-act=goto][data-i="3"] >> visible=true');
    await page.fill('input[id^=q_c_]','12');await page.fill('input[id^=q_n_]','10');
    check(await page.textContent('[id^=q_pct_]')==='Check','live percentage flags 12 of 10');
    await toEnd(page);
    await page.click('[data-act=savesession]');await page.waitForTimeout(100);
    check((await db(page,'sessions')).length===0&&/can.t be more/.test(await toastText(page)),'session not saved with 12 of 10');
    await go(page,'scores');await page.fill('#scN','30');await page.click('[data-act=addscore]');await page.waitForTimeout(100);
    check((await db(page,'scores')).length===0,'Add a score with Correct blank saves nothing');
    await page.context().close();
  }

  console.log('Mistakes keep the topic you pick (4)');
  {
    const page=await open(browser);
    await go(page,'mistakes');
    await page.selectOption('#mTopic','fsa');await page.fill('#mWhy','used ending inventory');await page.click('[data-act=addmistake]');await page.waitForTimeout(100);
    const m=await db(page,'mistakes');
    check(m.length===1&&m[0].data.topic==='fsa','mistake filed under FSA');
    await page.context().close();
  }

  console.log('Session date is the day it started (7)');
  {
    const page=await open(browser);
    await go(page,'session');await page.click('[data-act=begin]');
    await page.clock.fastForward('06:00:00'); // past midnight
    await toEnd(page);
    check(await page.inputValue('#fDate')==='2026-11-04','finish screen shows the start date');
    await page.click('[data-act=savesession]');await page.waitForTimeout(100);
    check((await db(page,'sessions'))[0]?.data.date==='2026-11-04','saved under the start date');
    await page.context().close();
  }

  console.log('An expired sign-in asks you to sign in again and keeps your changes (9)');
  {
    const page=await open(browser);
    await go(page,'progress');
    await page.evaluate(()=>__db.setFail('auth'));
    await page.evaluate(()=>{document.querySelector('details[data-topic=quant]').open=true});
    await page.check('input[data-act=moddone][data-id=q2]');await page.waitForTimeout(150);
    check(await page.isVisible('#auth')&&/expired/.test(await page.textContent('#lErr')),'sign-in form explains the sign-in expired');
    await page.evaluate(()=>__db.setFail(null));
    await page.fill('#lEmail','me@example.com');await page.fill('#lPass','x');await page.click('#lBtn');
    await page.waitForFunction(()=>document.querySelector('#sync')?.textContent.startsWith('Synced'));
    check((await db(page,'modules')).find(r=>r.id==='quant').data.items.find(m=>m.id==='q2').done===true,'the tick is saved after signing in');
    await page.context().close();
  }

  console.log('Public-computer mode never signs out mid-session (5)');
  {
    const page=await open(browser);
    await page.evaluate(()=>{localStorage.setItem('cfa-trusted','0');armIdle()});
    await go(page,'session');await page.click('[data-act=begin]');
    await page.clock.fastForward('02:00:00');
    check(await page.isVisible('#app'),'still signed in after 2 hours with the timer running');
    await page.click('[data-act=pause]');
    await page.clock.fastForward('00:56:00');
    check(await page.isVisible('#idleWarn'),'warning shows 5 minutes before signing out');
    await page.clock.fastForward('00:05:00');
    check(await page.isVisible('#auth'),'signs out after an hour idle once the timer is paused');
    await page.context().close();
  }

  console.log('Notes save straight away when you leave the page (10)');
  {
    const page=await open(browser);
    await go(page,'notes');await page.click('details.sec[data-sec=general] > summary');await page.fill('#nN_general','FIFO: lower COGS when prices rise');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.waitForTimeout(50);
    check((await db(page,'notes'))[0]?.data.notes==='FIFO: lower COGS when prices rise','note saved without waiting');
    await page.context().close();
  }

  console.log('Notes and formulas by module (27, 14)');
  {
    const page=await open(browser);
    await go(page,'notes');
    check(await page.$$eval('details.sec',d=>d.length)===3,'General plus one section per Quant module');
    await page.click('details.sec[data-sec=q1] > summary');
    await page.fill('#nF_q1','HPR = (P1 - P0 + D) / P0\nGeometric mean = [(1+R1)...(1+Rn)]^(1/n) - 1');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.waitForTimeout(50);
    const n=(await db(page,'notes')).find(r=>r.id==='quant')?.data;
    check(/HPR/.test(n?.mods?.q1?.formulas||''),'formulas saved under the module');
    check(/2 formulas/.test(await page.textContent('details.sec[data-sec=q1] summary')),'closed heading counts formulas');
    await page.reload();await page.waitForFunction(()=>document.querySelector('#sync')?.textContent.startsWith('Synced'));await go(page,'notes');
    check(await page.$eval('details.sec[data-sec=q1]',d=>d.open),'open sections are remembered');
    await page.fill('#nSearch','geometric');
    check(await page.$eval('details.sec[data-sec=q2]',d=>d.hidden)&&!(await page.$eval('details.sec[data-sec=q1]',d=>d.hidden)),'search shows only matching modules');
    await page.fill('#nSearch','');
    await page.click('[data-act=testmode]');
    await page.fill('#nRecall','HPR = (P1 - P0 + D) / P0');await page.click('[data-act=testcompare]');
    check(/1 of 2/.test(await page.textContent('#view')),'test me scores 1 of 2 recalled');
    check(await page.$$eval('.cmp .miss',e=>e.length)===1,'the missed formula is marked');
    await page.context().close();
  }

  console.log('Capture, mistakes and cards carry the module (27, 15, 21)');
  {
    const page=await open(browser);
    await go(page,'session');await page.click('[data-act=begin]'); // first open Quant module is q2
    await page.click('[data-act=goto][data-i="3"] >> visible=true');
    check(await page.inputValue('#mMod')==='q2','mistake form defaults to the session module');
    await page.fill('#mWhy','forgot to annualise');await page.click('[data-act=addmistake]');await page.waitForTimeout(80);
    await page.click('[data-act=goto][data-i="4"] >> visible=true');
    await page.fill('#fForm','Annualised return = (1 + r)^(365/t) - 1');
    await page.fill('#cFront_run','Annualise a 90-day return?');await page.fill('#cBack_run','(1 + r)^(365/90) - 1');await page.click('[data-act=addcard]');
    await toEnd(page);await page.click('[data-act=savesession]');await page.waitForTimeout(150);
    const n=(await db(page,'notes')).find(r=>r.id==='quant')?.data;
    check(/Annualised/.test(n?.mods?.q2?.formulas||'')&&!n?.formulas,'captured formula went to the module section');
    check((await db(page,'mistakes'))[0]?.data.moduleId==='q2','mistake saved with its module');
    check((await db(page,'cards'))[0]?.data.moduleId==='q2','card saved with its module');
    await go(page,'cards');
    const [dl]=await Promise.all([page.waitForEvent('download'),page.click('[data-act=ankidl]')]);
    const txt=fs.readFileSync(await dl.path(),'utf8');
    check(/#deck:CFA Level I/.test(txt)&&/#tags column:3/.test(txt)&&/\tcfa::quant::q2_types_of_financial_returns/.test(txt),'Anki file names deck, tags column and module tag');
    await go(page,'mistakes');
    check(/Quant/.test(await page.textContent('#view table'))&&/Types of Financial Returns/.test(await page.textContent('#view .list')),'mistakes show by topic with the module');
    await go(page,'progress');
    await page.evaluate(()=>{document.querySelector('details[data-topic=quant]').open=true});
    await page.click('[data-act=opennote][data-id=q2]');await page.waitForTimeout(100);
    check(await page.evaluate(()=>location.hash)==='#notes'&&await page.$eval('details.sec[data-sec=q2]',d=>d.open),'Progress links straight to the module notes');
    await page.context().close();
  }

  console.log('Session history, past sessions and today status (11, 19)');
  {
    const page=await open(browser);
    await go(page,'history');
    check(await page.evaluate(()=>location.hash==='#history'&&view==='progress'),'old Scores-style link lands on Progress');
    await page.click('[data-act=pastopen]');
    await page.fill('#psDate','2026-11-03');await page.fill('#psMins','45');await page.selectOption('#psMod','q2');
    await page.fill('#psQC','8');await page.fill('#psQN','10');await page.click('[data-act=pastsave]');await page.waitForTimeout(80);
    let ss=await db(page,'sessions');
    check(ss.length===1&&ss[0].data.minutes===45&&ss[0].data.moduleId==='q2'&&ss[0].data.quizzes[0].c===8,'past session logged with module and quiz');
    await page.click('[data-act=histedit]');await page.fill('#heMins','50');await page.click('[data-act=histsave]');await page.waitForTimeout(80);
    check((await db(page,'sessions'))[0].data.minutes===50,'edit changes the minutes');
    await go(page,'today');
    check(!/Done today/.test(await page.textContent('.next')),'no done-today line for yesterday\'s session');
    await go(page,'history');await page.click('[data-act=pastopen]');await page.fill('#psMins','30');await page.click('[data-act=pastsave]');await page.waitForTimeout(80);
    await go(page,'today');
    check(/Done today:<\/b> 30 min|Done today: 30 min/.test(await page.textContent('.next'))&&/Start another session/.test(await page.textContent('.next')),'Today shows what you already did');
    await go(page,'history');await page.click('[data-act=histedit] >> nth=0');await page.click('[data-act=histdel]');await page.click('[data-act=histdel]');await page.waitForTimeout(80);
    check((await db(page,'sessions')).length===1,'delete takes two taps and removes the session');
    await page.context().close();
  }

  console.log('Redo queue and mistake cards (12, 13)');
  {
    const seed=[...SEED,{coll:'mistakes',id:'m1',data:{date:'2026-10-30',topic:'quant',moduleId:'q2',qid:'Q7',tag:'formula',why:'forgot to annualise',rule:'(1+r)^(365/t)-1',redone:false}},
      {coll:'mistakes',id:'m2',data:{date:'2026-11-03',topic:'quant',qid:'Q9',tag:'calc',why:'too new',rule:'',redone:false}}];
    const page=await open(browser,{seed});
    check(/Mistakes due for a redo.*1/s.test(await page.textContent('.hero')),'Today counts only mistakes that are due');
    await go(page,'session');await page.click('[data-act=tpl][data-k=review]');await page.click('[data-act=begin]');await page.click('[data-act=goto][data-i="1"] >> visible=true');
    check(await page.$$eval('[data-act=redo][data-ok="1"]',b=>b.length)===1,'redo step lists the one due mistake');
    await page.click('[data-act=redo][data-ok="1"]');await page.waitForTimeout(50);
    let m=(await db(page,'mistakes')).find(r=>r.id==='m1').data;
    check(!m.redone&&m.nextRedo==='2026-11-11','first right answer schedules a check a week later');
    await page.clock.fastForward(8*24*3600*1000);await page.evaluate(()=>forceRender());
    await page.click('[data-act=redo][data-id=m1][data-ok="1"]');await page.waitForTimeout(50);
    m=(await db(page,'mistakes')).find(r=>r.id==='m1').data;
    check(m.redone===true,'second right answer a week later closes it');
    await page.click('[data-act=redo][data-id=m2][data-ok="0"]');await page.waitForTimeout(50);
    m=(await db(page,'mistakes')).find(r=>r.id==='m2').data;
    check(!m.redone&&m.nextRedo==='2026-11-15','a miss brings it back in 3 days');
    await page.click('[data-act=abandon]');await page.click('[data-act=abandon]');
    await go(page,'mistakes');await page.uncheck('#mOpen');
    await page.click('[data-act=mcard][data-id=m1]');
    check(await page.inputValue('#mcBack')==='(1+r)^(365/t)-1','card form starts from the rule');
    await page.fill('#mcFront','How do you annualise a t-day return?');await page.click('[data-act=mcardsave]');await page.waitForTimeout(80);
    const c=(await db(page,'cards'))[0]?.data;
    check(c&&c.moduleId==='q2'&&c.topic==='quant','card queued with the mistake\'s topic and module');
    check(/card made/.test(await page.textContent('#view .list')),'mistake shows a card was made');
    await page.context().close();
  }

  console.log('Mock topic results feed topic averages (22)');
  {
    const page=await open(browser,{seed:[...SEED,{coll:'scores',id:'mk1',data:{type:'mock',topic:'',date:'2026-11-03',c:120,n:180,pct:67}}]});
    await go(page,'scores');
    check(await page.evaluate(()=>!!document.querySelector('nav a[data-nav=progress][aria-current=page]')),'Scores now lives on Progress');
    await page.click('[data-act=mocktopics][data-id=mk1]');
    await page.fill('#mt_c_fsa','10');await page.fill('#mt_n_fsa','20');await page.fill('#mt_c_quant','9');await page.fill('#mt_n_quant','10');
    await page.click('[data-act=mocksave]');await page.waitForTimeout(80);
    check((await db(page,'scores'))[0].data.topics.fsa.c===10,'topic results saved on the mock');
    check(/Weakest: FSA 50%/.test(await page.textContent('#scoresSec')),'mock row shows the weakest topics');
    check(await page.evaluate(()=>topicQuiz('fsa').some(r=>r.p===50)),'FSA average includes the mock result');
    await page.context().close();
  }

  console.log('The Supabase script is pinned with an integrity hash (25)');
  {
    const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
    check(/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js" integrity="sha384-[A-Za-z0-9+\/=]{64}" crossorigin="anonymous"/.test(html),'script tag has an exact version, sha384 integrity and crossorigin');
    check(/connect-src[^;]*supabase\.co/.test(HEADERS['Content-Security-Policy']||''),'CSP allows Supabase and nothing else to be called');
  }

  console.log('Backup downloads and restores (20)');
  {
    const page=await open(browser);
    const [dl]=await Promise.all([page.waitForEvent('download'),page.click('[data-act=backup] >> nth=0')]);
    const file=await dl.path(), j=JSON.parse(fs.readFileSync(file,'utf8'));
    check(j.app==='cfa-hub'&&j.data.modules.quant.items.length===2,'backup file has the modules');
    await page.evaluate(()=>{__db.rows=__db.rows.filter(r=>r.coll!=='modules');__db.save()});
    page.once('dialog',d=>d.accept());
    await page.setInputFiles('#restoreFile',file);await page.waitForTimeout(200);
    check((await db(page,'modules')).length===1,'restore puts the modules back');
    await page.context().close();
  }

  await browser.close();
  console.log(failures?`\n${failures} check(s) failed`:'\nAll checks passed');
  process.exit(failures?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
