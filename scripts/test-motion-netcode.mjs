// Deterministic regression tests for raw authoritative movement and transport state.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";

const bundle = await build({ stdin: { contents: 'export * from "./src/game/engine"; export * from "./src/game/viewers"; export * from "./src/game/wire"; export * from "./src/game/buildings";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "cjs", platform: "node", packages: "external", logLevel: "silent" });
const file = `${process.cwd()}/scripts/.motion-test.cjs`;
const mod = new Module(file); mod.filename=file; mod.paths=Module._nodeModulePaths(process.cwd()); mod._compile(bundle.outputFiles[0].text,file);
const g=mod.exports;
const realNow=Date.now;
let now=realNow(); Date.now=()=>now;
try {
  const ids=Array.from({length:4},()=>crypto.randomUUID());
  const code=g.createRoom(ids[0],"Motion");
  for(let i=1;i<4;i++) g.joinRoom(code,ids[i],`Motion${i}`);
  const room=g.getRoom(code); assert.ok(g.startGame(room,ids[3]).ok);
  const p=room.players.get(ids[0]); p.x=900;p.subX=0;
  for(const q of room.players.values())q.lastSeen=now;
  const step=()=>{now+=g.TICK_MS;g.advanceRoomForTest(room,now);room.rev++;};
  assert.ok(g.handleInput(room,{playerId:p.id,dir:1,seq:100}).ok);
  let previous=p.x;
  for(let i=0;i<30;i++){
    step(); const draw=g.snapshot(room,p.id).players.find(q=>q.id===p.id).drawX;
    assert.equal(typeof draw,"number","wire includes actual server subpixel position");
    assert.ok(Math.abs(draw-previous-190*g.TICK_MS/1000)<.003,"per-tick drawn distance is uniform, not 1/2px alternating");
    assert.ok(Number.isInteger(p.x),"gameplay coordinates remain integers");
    previous=draw;
  }
  g.handleInput(room,{playerId:p.id,dir:0,seq:101});step();
  assert.equal(g.snapshot(room,p.id).players.find(q=>q.id===p.id).drawX,previous,"stop never snaps backwards by clearing remainder");
  const checkpoint=structuredClone(room.history[0]);
  g.handleInput(room,{playerId:p.id,dir:-1,seq:99});
  assert.equal(p.dir,0,"stale steering cannot undo stop");
  assert.equal(g.snapshot(room,p.id).self.steerSeq,101,"reload can discover sequence high-water mark");
  const before=p.x;
  g.handleInput(room,{playerId:p.id,dir:0,seq:105,tapDir:1});
  assert.equal(p.x,before,"out-of-order quick tap never teleports/nudges through collisions");
  const seqEntries=room.journal.filter(e=>e.kind==="input" && e.playerId===p.id);
  assert.ok(!seqEntries.some(e=>e.body?.dir===-1),"rejected steering is not journaled and resurrected on replay");
  // Integer door bounds and no residual bounce when pushing into a wall.
  const b=g.BUILDINGS.find(b=>b.id==="tollhouse");
  p.inside=b.id;p.x=g.doorX(b)-2;p.subX=0;
  const door=room.doors.find(d=>d.id===b.id);door.open=false;
  g.handleInput(room,{playerId:p.id,dir:1,seq:106});
  for(let i=0;i<20;i++){step();assert.ok(Number.isInteger(p.x));assert.ok(g.snapshot(room,p.id).players.find(q=>q.id===p.id).drawX<g.doorX(b));}
  // Isolated SSE cursors: two connections for the same seat must not churn full snapshots.
  p.inside=null;p.x=1600;p.subX=0;
  const a=g.createViewerCursor(true),c=g.createViewerCursor();
  let ar=g.nextFrame(room,p.id,null,now,false,a).frame;
  let cr=g.nextFrame(room,p.id,null,now,false,c).frame;
  let ah=g.applyFrame(null,ar),ch=g.applyFrame(null,cr),ae=ar.etag,ce=cr.etag;
  let legacyBytes=0, compactBytes=0;
  let lastAn=ar.n,lastCn=cr.n;
  for(let i=0;i<25;i++){
    step();
    ar=g.nextFrame(room,p.id,ae,now,false,a).frame;
    cr=g.nextFrame(room,p.id,ce,now,false,c).frame;
    assert.ok(ar && cr);assert.ok(!ar.snap && !cr.snap,"independent streams continue as deltas");
    assert.equal(ar.base,ae);assert.equal(cr.base,ce);assert.equal(ar.n,lastAn+1,"frame numbers advance on the SSE cursor");assert.equal(cr.n,lastCn+1,"frame numbers advance independently per connection");lastAn=ar.n;lastCn=cr.n;assert.ok(ar.motion?.length,"v2 compacts actual motion");assert.ok(!cr.motion,"legacy clients retain field patches");
    ah=g.applyFrame(ah,ar,ae);ch=g.applyFrame(ch,cr,ce);
    assert.deepEqual(ah,ch);legacyBytes+=JSON.stringify(cr).length;compactBytes+=JSON.stringify(ar).length;ae=ar.etag;ce=cr.etag;
    assert.equal(g.viewFingerprint(g.encodeView(ah)),ae);
  }
  assert.equal(g.applyFrame(ah,{now,etag:"future",base:"wrong",patch:{players:[{i:0,x:-999}]}},ae),null,"wrong-base delta forces full resync, never a backwards jump");
  assert.ok(compactBytes<legacyBytes,"negotiated compact motion uses fewer bytes for identical values");
  p.x=900;p.subX=0;p.inside=null;p.hasSupply=false;room.cartX=900;room.cartSubX=0;
  g.handleInput(room,{playerId:p.id,dir:1,cartHeld:true,seq:107});
  for(let i=0;i<125;i++){
    step();const s=g.snapshot(room,p.id);
    assert.equal(s.players.find(q=>q.id===p.id).drawX,s.cartDrawX,"pusher and cart stay in exact subpixel lockstep");
  }
  assert.equal(checkpoint.players.length,4);
  console.log(`COMPACT_WIRE: ${compactBytes} vs ${legacyBytes} bytes, identical authoritative values`);
  console.log("MOTION_NETCODE_OK: uniform subpixel steps, stop/wall bounds, stale-input replay, independent stream cursors, delta chain");
  Date.now=realNow;process.exit(0);
}catch(err){Date.now=realNow;console.error(err);process.exit(1);}
