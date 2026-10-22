import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, capture, changeStatus, cleanPath, emptyWorkspace, fingerprint, groupIssues, histogram, MAX_EVENTS, parseWorkspace, sampleWorkspace, sanitize } from '../src/core.ts';
import { installCollector } from '../src/collector.ts';
const base = { type:'TypeError', message:'Cannot read products', kind:'error' as const, source:'https://demo.test/app.js',line:42,column:9 };

test('same normalized message and location produce the same identity',async()=>{
 assert.equal(await fingerprint(base),await fingerprint({...base,message:'  Cannot read products  ',source:'https://demo.test/app.js?token=secret#section'}));
});
test('meaningful numbers and different source locations remain distinct',async()=>{
 assert.notEqual(await fingerprint({...base,message:'Request failed: 401'}),await fingerprint({...base,message:'Request failed: 500'}));
 assert.notEqual(await fingerprint(base),await fingerprint({...base,line:43}));
});
test('ten concurrent captures group into one in-memory issue with ten occurrences',async()=>{
 const events=await Promise.all(Array.from({length:10},(_,i)=>capture(base,1000+i)));
 const state=events.reduce(appendEvent,emptyWorkspace(0));const issues=groupIssues(state);
 assert.equal(state.events.length,10);assert.equal(issues.length,1);assert.equal(issues[0].count,10);
 assert.equal(issues[0].firstSeen,1000);assert.equal(issues[0].lastSeen,1009);
});
test('distinct errors remain separate, while a matching recurrence retains manual resolved status',async()=>{
 const a=await capture(base,1000);const b=await capture({...base,type:'ReferenceError',message:'Missing variable'},2000);
 let state=appendEvent(appendEvent(emptyWorkspace(),a),b);state=changeStatus(state,a.fingerprint,'resolved');
 state=appendEvent(state,await capture(base,3000));const issues=groupIssues(state);
 assert.equal(issues.length,2);assert.equal(issues[0].count,2);assert.equal(issues[0].status,'resolved');
 state=changeStatus(state,a.fingerprint,'open');assert.equal(groupIssues(state)[0].status,'open');
});
test('URL query, fragment, common credentials, and email are removed',()=>{
 const safe=sanitize({...base,message:'user@example.com token=secret Bearer token-value',stack:'at https://demo.test/app.js?access_token=xyz#hash',page:'/checkout?token=abc#result'});
 assert.equal(cleanPath('https://a.test/path?token=x#hash'),'/path');
 assert.equal(safe.page,'/checkout');assert.ok(!safe.message.includes('secret'));assert.ok(!safe.message.includes('user@example.com'));
 assert.ok(!safe.message.includes('token-value'));assert.equal(safe.stack,'at https://demo.test/app.js');
});
test('oversized fields are bounded and invalid event kinds are rejected',()=>{
 const safe=sanitize({...base,message:'x'.repeat(3000),stack:'y'.repeat(12000)});
 assert.equal(safe.message.length,1024);assert.equal(safe.stack?.length,8192);
 assert.throws(()=>sanitize({...base,kind:'other' as 'error'}));assert.throws(()=>sanitize({...base,message:''}));
});
test('JSON storage round trip preserves events and status, while malformed records are rejected',async()=>{
 const e=await capture(base);let state=appendEvent(emptyWorkspace(),e);state=changeStatus(state,e.fingerprint,'resolved');
 const restored=parseWorkspace(JSON.stringify(state));assert.ok(restored);
 assert.equal(restored.events.length,1);assert.equal(restored.events[0].id,e.id);
 assert.equal(restored.events[0].fingerprint,e.fingerprint);assert.equal(restored.events[0].timestamp,e.timestamp);
 assert.equal(groupIssues(restored)[0].status,'resolved');assert.equal(groupIssues(restored)[0].count,1);
 assert.equal(parseWorkspace('{'),null);assert.equal(parseWorkspace(JSON.stringify({...state,events:[{id:'bad'}]})),null);
});
test('retention bounds events and removes status metadata for an expired issue',async()=>{
 const old=await capture({...base,message:'old'},0);const next=await capture(base,1);
 let state=appendEvent(emptyWorkspace(),old);state=changeStatus(state,old.fingerprint,'resolved');
 for(let i=0;i<MAX_EVENTS;i++)state=appendEvent(state,{...next,id:String(i),timestamp:i+1});
 assert.equal(state.events.length,MAX_EVENTS);assert.equal(groupIssues(state).length,1);assert.equal(state.statuses[old.fingerprint],undefined);
});
test('histogram includes only the selected time window',async()=>{
 const now=100000000;const e=await capture(base,now);
 const values=histogram([{...e,timestamp:now-1800000},{...e,timestamp:now},{...e,timestamp:now-7200000},{...e,timestamp:now+1}],1,now,4);
 assert.deepEqual(values,[0,0,1,1]);
});
test('sample data is explicitly synthetic and matches the documented 76-event six-issue fixture',async()=>{
 const sample=await sampleWorkspace(100000000);const issues=groupIssues(sample);
 assert.equal(sample.events.length,76);assert.equal(issues.length,6);assert.ok(sample.events.every(e=>e.synthetic));
 assert.equal(issues.filter(i=>i.status==='resolved').length,2);assert.equal(issues.filter(i=>i.status==='open').length,4);
});
test('collector installation replaces old listeners and captures a browser-style error event once',async()=>{
 const target=new EventTarget();Object.assign(globalThis,{window:target,location:{pathname:'/demo'}});
 let oldCalls=0;const previous=installCollector({send:async event=>event,onCapture:()=>oldCalls++,onFailure:()=>{}});
 let resolve:(e:any)=>void=()=>{};const result=new Promise<any>(r=>{resolve=r;});
 const cleanup=installCollector({send:async event=>event,onCapture:resolve,onFailure:()=>{}});
 const event=Object.assign(new Event('error'),{message:'Synthetic error event',error:new TypeError('Synthetic error event'),filename:'https://demo.test/source.js',lineno:8,colno:2});
 target.dispatchEvent(event);const received=await result;
 assert.equal(oldCalls,0);assert.equal(received.type,'TypeError');assert.equal(received.kind,'error');assert.equal(received.source,'/source.js');assert.equal(received.synthetic,false);
 cleanup();previous();
});
test('collector handles a non-Error rejection without serializing its object',async()=>{
 const target=new EventTarget();Object.assign(globalThis,{window:target,location:{pathname:'/demo'}});
 let resolve:(e:any)=>void=()=>{};const result=new Promise<any>(r=>{resolve=r;});
 const cleanup=installCollector({send:async event=>event,onCapture:resolve,onFailure:()=>{}});
 target.dispatchEvent(Object.assign(new Event('unhandledrejection'),{reason:{password:'never serialize'}}));
 const received=await result;assert.equal(received.message,'Unhandled non-Error rejection');assert.ok(!JSON.stringify(received).includes('never serialize'));cleanup();
});
