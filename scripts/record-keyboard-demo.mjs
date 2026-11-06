// Run against the isolated fixture server only: E2E_PORT=3110 npm run test:e2e:serve.
// This is an automated demonstration, not a claim that the student performed it.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base='http://127.0.0.1:3110';
const out='docs/accessibility';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:900},recordVideo:{dir:out,size:{width:1280,height:900}}});
await context.addInitScript(()=>{
 document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('div');
  panel.setAttribute('aria-hidden','true');
  panel.style.cssText='position:fixed;bottom:12px;left:20px;right:20px;z-index:10000;background:#fff;color:#0a0a0a;padding:12px 20px;border-radius:12px;font:16px system-ui;pointer-events:none;box-shadow:0 3px 12px #0008';
  document.body.append(panel);
  window.demoCaption=(text)=>{sessionStorage.setItem('demoCaption',text);panel.textContent='Automated keyboard-only demo • '+text;};
  window.demoCaption(sessionStorage.getItem('demoCaption')||'Tab and Enter navigate; no mouse input');
  document.addEventListener('keydown',event=>{
   if(['Tab','Enter',' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)){
    panel.textContent='Automated keyboard-only demo • '+sessionStorage.getItem('demoCaption')+'   |   Key: '+(event.shiftKey?'Shift + ':'')+(event.key===' '?'Space':event.key);
   }
  },true);
 });
});
const page=await context.newPage();
const fixture=await (await page.request.get(base+'/__test/fixtures')).json();
const started=Date.now();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const caption=async text=>{await page.evaluate(text=>window.demoCaption(text),text);await pause(1300);};
const key=async value=>{await page.keyboard.press(value);await pause(400);};
async function tabTo(selector,back=false){
 for(let i=0;i<90;i++){
  if(await page.evaluate(selector=>document.activeElement?.matches(selector),selector))return;
  await key(back?'Shift+Tab':'Tab');
 }
 throw new Error('Keyboard target unreachable: '+selector);
}
try{
 await page.goto(base+'/login');
 await caption('Log in with Tab, Enter and keyboard typing');
 await key('Tab');await key('Enter');await key('Tab');
 await page.keyboard.type('coach-0@example.test',{delay:50});await key('Tab');
 await page.keyboard.type('browser-fixture-password',{delay:35});await key('Tab');await key('Enter');
 await page.waitForURL('**/matches');
 await caption('Open Agent through the main navigation');
 await tabTo('a[href="/agent"]');await key('Enter');await page.waitForURL('**/agent');
 await caption('Tab through labelled coaching fields and expand the tactics');
 await tabTo('summary');await key('Enter');await pause(3500);await key('Enter');
 await caption('Shift + Tab moves backward to navigation');
 await tabTo('a[href="/rankings"]',true);await key('Enter');await page.waitForURL('**/rankings');
 await caption('Skip navigation and reach the native game filter');
 await key('Tab');await key('Enter');await key('Tab');await pause(2000);
 await caption('Open Matches, then a completed replay');
 await tabTo('a[href="/matches"]',true);await key('Enter');await page.waitForURL('**/matches');
 await tabTo('a[href="/matches/'+fixture.ids.tic+'"]');await key('Enter');await page.waitForURL('**/matches/'+fixture.ids.tic);
 await caption('Skip to the match; Home, arrows and End move the replay');
 await key('Tab');await key('Enter');await tabTo('#replay-seek');
 await key('Home');await pause(2000);await key('ArrowRight');await pause(2000);
 await caption('Previous at the start returns focus to the replay slider');
 await key('Tab');await key('Enter');await pause(2500);await key('End');
 await caption('Use Enter on an activity card to inspect its position');
 await tabTo('.event-select');await key('Enter');await pause(2500);
 await caption('Keyboard walkthrough complete: navigation, forms, disclosure and replay');
 await pause(Math.max(3000,90000-(Date.now()-started)));
 console.log(JSON.stringify({durationSeconds:(Date.now()-started)/1000}));
 const video=page.video();
 await context.close();
 await video.saveAs(out+'/keyboard-demo.webm');
 await video.delete();
}finally{await context.close();await browser.close();}
