// Runs the integration page in an isolated, temporary Chrome profile.
// Requires Node 22+ (fetch/WebSocket) and Chrome with WebGPU support.
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSmooshServer } from '../serve.mjs';
import { buildSite } from '../scripts/build-site.mjs';
import { runMobileChecks } from './mobile.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const chromePath = process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : '/usr/bin/google-chrome');
let server, chrome, profile, socket, chromeLog = '';
try {
  await access(chromePath);
  await buildSite();
  profile = await mkdtemp(path.join(tmpdir(), 'smoosh-chrome-'));
  server = createSmooshServer(); await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const url = `http://127.0.0.1:${server.address().port}/test/browser.html`;
  chrome = spawn(chromePath, ['--headless=new','--no-first-run','--no-default-browser-check','--disable-default-apps','--enable-unsafe-webgpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  let launchError;
  chrome.once('error',error=>{launchError=error;});
  chrome.stderr.on('data',data=>{chromeLog=(chromeLog+data).slice(-8000);});
  const deadline = Date.now() + 120_000;
  let debuggerInfo;
  while (!debuggerInfo && Date.now() < deadline) {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before testing: ${chromeLog}`);
    try { debuggerInfo = (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n'); } catch { await delay(100); }
  }
  if (!debuggerInfo) throw new Error('Chrome did not expose a debugging endpoint');
  socket = new WebSocket(`ws://127.0.0.1:${debuggerInfo[0]}${debuggerInfo[1]}`);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0; const pending=new Map();
  socket.addEventListener('message',event=>{
    const m=JSON.parse(event.data),request=pending.get(m.id);
    if(request){pending.delete(m.id);if(m.error)request.reject(new Error(JSON.stringify(m.error)));else request.resolve(m.result);}
  });
  const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));
  });
  const {targetId}=await command('Target.createTarget',{url});
  const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  let result;
  while(Date.now()<deadline){
    try {
      const response=await command('Runtime.evaluate',{expression:'window.smooshTestResult ?? null',returnByValue:true},sessionId);
      result=response.result?.value;if(result)break;
    } catch(error) { if(!/execution context|context.*destroyed/i.test(error.message))throw error; }
    await delay(100);
  }
  if(!result)throw new Error(`GPU tests timed out. Chrome output: ${chromeLog}`);
  const mobile=await runMobileChecks(command,sessionId,`http://127.0.0.1:${server.address().port}/`);
  result.tests.push(...mobile);result.passed=result.passed&&mobile.every(t=>t.pass);
  console.log(JSON.stringify(result,null,2));
  if(!result.passed)process.exitCode=1;
}catch(error){console.error(error.stack??error.message);process.exitCode=1;}
finally{
  socket?.close();
  if(chrome&&chrome.exitCode===null){
    chrome.kill('SIGTERM');
    for(let i=0;i<20&&chrome.exitCode===null;i++)await delay(100);
    if(chrome.exitCode===null){chrome.kill('SIGKILL');await new Promise(resolve=>chrome.once('exit',resolve));}
  }
  if(server)await new Promise(resolve=>server.close(resolve));
  if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
