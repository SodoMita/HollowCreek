// Lifecycle and cached-replay regressions invisible in a still image.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const bundle=await build({stdin:{contents:'export * from "./src/game/engine"; export { GET as streamGET } from "./src/app/api/game/state/stream/route"; export * from "./src/game/viewers"; export { POST as inputPOST } from "./src/app/api/game/input/route"; export { allow } from "./src/server/rate-limit";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"cjs",platform:"node",packages:"external",logLevel:"silent"});
const file=`${process.cwd()}/scripts/.server-cadence.cjs`;
const mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(process.cwd());mod._compile(bundle.outputFiles[0].text,file);
const g=mod.exports;
clearTimeout(globalThis.__hollowLoop);
const realNow=Date.now;let now=realNow();Date.now=()=>now;
try{
  const ids=Array.from({length:4},()=>crypto.randomUUID());
  const code=g.createRoom(ids[0],"Cadence");for(let i=1;i<4;i++)g.joinRoom(code,ids[i],`Cadence${i}`);
  const room=g.getRoom(code);assert.ok(g.startGame(room,ids[3]).ok);
  const players=[...room.players.values()],visitor=players.find(p=>p.role==="crew"),actor=players.find(p=>p.id!==visitor.id);
  for(const p of players){p.x=1500;p.dir=0;p.lastSeen=now;}
  visitor.x=1260;actor.dir=1;room.keyX=3500;
  room.history=[];room.lastHistoryAt=0;g.captureHistory(room,now,true);const origin=now;
  for(let i=0;i<160;i++){now+=g.TICK_MS;g.advanceRoomForTest(room,now);}
  assert.ok(g.handleInput(room,{playerId:visitor.id,action:"interact"}).ok);
  assert.ok(g.handleInput(room,{playerId:visitor.id,action:"time_travel",targetAt:origin}).ok);
  assert.ok(g.handleInput(room,{playerId:visitor.id,dir:1,seq:900}).ok);
  const pick=s=>({players:[...s.players.values()].map(p=>[p.id,p.x,p.subX,p.walkCycle,p.dir,p.alive,p.inside,p.hasKey,p.hasSupply]),doors:s.doors,pool:s.pool,cartX:s.cartX,cartSubX:s.cartSubX});
  for(let i=0;i<36;i++){
    now+=g.TICK_MS;g.advanceRoomForTest(room,now);
    const cursor=room.timeVisit.originAt+(now-room.timeVisit.startedAt);
    const cached=g.simulatePastForTest(room,cursor),fresh=g.simulatePastUncachedForTest(room,cursor);
    assert.deepEqual(pick(cached),pick(fresh),`incremental replay equals fresh replay at step ${i}`);
    cached.players.get(room.timeVisit.visitorId).x=-9999;
    assert.deepEqual(pick(g.simulatePastForTest(room,cursor)),pick(fresh),"callers cannot mutate the cached world");
  }
  const originalVisit=room.timeVisit;
  const lateVisit={...originalVisit,originAt:now,startedAt:now,actions:[]};
  room.timeVisit=lateVisit;
  g.simulatePastForTest(room,now); // prime exactly at this millisecond
  g.advanceRoomForTest(room,now); // append another legitimate tick at the SAME millisecond
  assert.deepEqual(pick(g.simulatePastForTest(room,now)),pick(g.simulatePastUncachedForTest(room,now)),"same-timestamp appended events cannot be skipped by cache");
  room.timeVisit=originalVisit;
  assert.equal(g.snapshot(room,visitor.id).self.steerSeq,900,"past view acknowledges live transport sequence, not historical sequence");
  assert.ok(g.handleInput(room,{playerId:visitor.id,action:"time_return"}).ok);
  // Cancelling/aborting route streams releases all listeners and interval timers.
  const request=signal=>{const r=new Request(`http://local/api/game/state/stream?code=${code}&playerId=${visitor.id}`,{signal});Object.defineProperty(r,"nextUrl",{value:new URL(r.url)});return r;};
  const ctl=new AbortController();
  const response=await g.streamGET(request(ctl.signal));
  assert.equal(response.status,200);assert.equal(g.roomEventListenerCount(code),1);
  await response.body.cancel();assert.equal(g.roomEventListenerCount(code),0,"cancel cleans up the stream listener");
  const ctl2=new AbortController();const response2=await g.streamGET(request(ctl2.signal));
  assert.equal(g.roomEventListenerCount(code),1);ctl2.abort();
  assert.equal(g.roomEventListenerCount(code),0,"abort also cleans up");await response2.body.cancel().catch(()=>{});
  for(const p of room.players.values()){p.lastSeen=0;p.dir=1;}
  let emits=0;const stop=g.onRoomEvent(code,()=>emits++);
  g.tickRooms();const afterRelease=emits;
  for(let i=0;i<100;i++){now+=g.TICK_MS;g.tickRooms();}
  assert.equal(emits,afterRelease,"abandoned match sleeps instead of ticking forever");
  g.handleInput(room,{playerId:visitor.id,dir:1,seq:901});g.tickRooms();assert.ok(emits>afterRelease,"fresh input wakes the match");
  room.phase="ended";const ended=emits;for(let i=0;i<50;i++){now+=g.TICK_MS;g.tickRooms();}assert.equal(emits,ended,"ended matches do not churn ticks");stop();
  room.phase="playing";
  g.leaveRoom(code,visitor.id,1000);
  g.handleInput(room,{playerId:visitor.id,dir:1,seq:999});
  assert.equal(visitor.dir,0,"late pre-Leave press cannot restart an abandoned player");
  room.phase="ended";for(const p of room.players.values())p.isHost=p.id===visitor.id;
  assert.ok(g.handleInput(room,{playerId:visitor.id,action:"restart",seq:1001}).ok);
  assert.equal(visitor.steerSeq,1001,"rematch never resets the steering high-water mark");
  g.handleInput(room,{playerId:visitor.id,dir:1,seq:1000});assert.equal(visitor.dir,0,"old-round input stays stale");
  // Exhaust the ordinary input window: STOP must still be delivered.
  for(let i=0;i<1800;i++)g.allow(`input:soul:${code}:${visitor.id}`,1800,60000);
  const inputReq=body=>new Request("http://local/api/game/input",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code,playerId:visitor.id,...body})});
  assert.equal((await g.inputPOST(inputReq({seq:1002,dir:1}))).status,429);
  g.handleInput(room,{playerId:visitor.id,seq:1002,dir:1});
  assert.equal((await g.inputPOST(inputReq({seq:1003,dir:0,cartHeld:false,interactHeld:false}))).status,200);
  assert.equal(visitor.dir,0,"release stays deliverable after ordinary input budget is spent");
  // Tick health is reported, bounded, and always has a p50 even under load.
  // Real spacing, not a synchronous burst, so the interval is meaningful.
  for (let i = 0; i < 3; i++) { g.tick(); await new Promise((r) => setTimeout(r, 12)); }
  const health = g.tickStats();
  assert.ok(health.samples > 0, "tick health samples recorded");
  assert.ok(health.interval && health.interval.p50 > 0, "tick interval p50 reported");
  assert.ok(health.work && health.work.max >= 0, "tick work time reported");
  assert.equal(typeof health.late, "number", "late tick counter reported");
  // Frame numbers: a new connection always starts from its own baseline.
  const c1 = g.createViewerCursor(), c2 = g.createViewerCursor();
  const f1 = g.nextFrame(room, visitor.id, null, now, true, c1).frame;
  const f2 = g.nextFrame(room, visitor.id, null, now, true, c2).frame;
  assert.equal(f1.n, 1); assert.equal(f2.n, 1, "each connection numbers its own frames independently");
  // The refresh gate defers a second frame inside one display interval and keeps
  // the delta baseline intact instead of emitting stale intermediate positions.
  const gated = g.nextFrame(room, visitor.id, f1.etag, now + 4, false, c1, 16);
  assert.equal(gated.frame, null, "no frame inside the refresh interval");
  assert.equal(gated.deferred, true, "deferred work is signalled so the route reschedules");
  // Genuinely new authoritative state, then one display interval later.
  visitor.x += 7; visitor.dir = 0;
  for (const q of room.players.values()) q.lastSeen = now;
  const nextSlot = g.nextFrame(room, visitor.id, f1.etag, now + 20, false, c1, 16);
  assert.ok(nextSlot.frame, "a frame is produced at the next display slot");
  visitor.dir = 0;
  console.log("SERVER_CADENCE_OK: cached replay oracle, live sequence in past, stream cancellation, idle sleep/wake, late-Leave input");
  Date.now=realNow;process.exit(0);
}catch(e){Date.now=realNow;console.error(e);process.exit(1);}
