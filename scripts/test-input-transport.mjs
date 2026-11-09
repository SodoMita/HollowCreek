import assert from "node:assert/strict";
import { build } from "esbuild";
const out=await build({entryPoints:["static-src/input-transport.ts"],bundle:true,write:false,format:"esm",platform:"neutral",logLevel:"silent"});
const {InputTransport}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const steer=dir=>({dir,cartHeld:false,interactHeld:false});
const ok=()=>new Response('{"ok":true}',{status:200});
let identity={code:"AAAA",playerId:"p",base:"https://test.invalid"};
const errors=[];
const options=fetcher=>({identity:()=>identity,rtt:()=>{},error:m=>errors.push(m),failed:()=>errors.push("failed"),fetcher});
// Resumed sequence must exceed the old tab's last accepted packet.
{
  const calls=[];
  const t=new InputTransport(options(async (_url,init)=>{calls.push(JSON.parse(init.body));return ok();}));
  t.resume(80);await t.steer(steer(1));await t.steer(steer(0));
  assert.deepEqual(calls.map(c=>c.seq),[81,82]);assert.ok(calls.every(c=>!("x"in c)),"never sends positions");
}
// STOP dispatches immediately, without waiting for the previous request's round trip.
{
  const calls=[],resolvers=[];
  const t=new InputTransport(options((_url,init)=>{calls.push(JSON.parse(init.body));return new Promise(r=>resolvers.push(r));}));
  const a=t.steer(steer(1)),b=t.steer(steer(0));
  assert.equal(calls.length,2,"release was not serialized behind in-flight movement");
  resolvers[1](ok());resolvers[0](ok());await Promise.all([a,b]);
}
// A lost STOP is retried idempotently with the same sequence.
{
  const calls=[];
  const t=new InputTransport(options(async (_url,init)=>{const b=JSON.parse(init.body);calls.push(b);if(calls.length===1)throw Error("lost packet");return ok();}));
  await t.steer(steer(0));assert.equal(calls.length,2);assert.equal(calls[0].seq,calls[1].seq);
}
// Never retry an old direction after a newer STOP supersedes it.
{
  const calls=[];
  const t=new InputTransport(options(async (_url,init)=>{const b=JSON.parse(init.body);calls.push(b);if(b.dir===1)throw Error("lost press");return ok();}));
  const first=t.steer(steer(1));await wait(10);await t.steer(steer(0));await first;
  assert.equal(calls.filter(c=>c.dir===1).length,1);assert.equal(calls.at(-1).dir,0);
}
// A callback from a previous room must neither retry nor display errors in the new room.
{
  const calls=[];
  const t=new InputTransport(options(async (_url,init)=>{const b=JSON.parse(init.body);calls.push(b);if(b.code==="AAAA")throw Error("old room down");return ok();}));
  const old=t.steer(steer(1));await wait(10);t.reset();identity={...identity,code:"BBBB"};await t.steer(steer(0));await old;
  assert.equal(calls.filter(c=>c.code==="AAAA").length,1);assert.equal(calls.at(-1).code,"BBBB");
}
assert.deepEqual(errors,[]);
console.log("INPUT_TRANSPORT_OK: sequence resume, immediate stop, lost-stop retry, supersession, room isolation");
