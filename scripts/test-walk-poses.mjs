// Browser regression: every gait pose renders synchronously, without asynchronous SVG pose swaps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
const out=await build({stdin:{contents:'export { preloadArt, drawTraveler, setArtScale } from "./src/game/svg-assets";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"iife",globalName:"Art",platform:"browser",logLevel:"silent"});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
  const page=await browser.newPage();
  await page.route("http://poses.test/**",route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.startsWith("/art/")){
      const file=resolve("public",pathname.slice(1));
      return route.fulfill({contentType:extname(file)===".svg"?"image/svg+xml":"text/plain",body:readFileSync(file)});
    }
    return route.fulfill({contentType:"text/html",body:'<meta name="hc-art-base" content="/art/"><canvas width="160" height="216" id="c"></canvas>'});
  });
  await page.goto("http://poses.test/");await page.addScriptTag({content:out.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
    await Art.preloadArt();
    const c=document.getElementById("c"),g=c.getContext("2d",{willReadFrequently:true});
    const hashes=[],missing=[];
    for(let pose=1;pose<=32;pose++){
      g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,c.width,c.height);g.setTransform(4,0,0,4,80,216);
      Art.setArtScale(4);
      if(!Art.drawTraveler(g,"#c0392b",false,false,pose,1))missing.push(pose);
      const data=g.getImageData(0,130,160,86).data;let h=2166136261;
      for(let i=0;i<data.length;i++){h^=data[i];h=Math.imul(h,16777619);}
      hashes.push(h>>>0);
    }
    const mirrored=Art.drawTraveler(g,"#c0392b",false,false,17,-1);
    const NativeImage=window.Image;let newImages=0;
    window.Image=class extends NativeImage { constructor(...args){super(...args);newImages++;} };
    const colors=["#c0392b","#d35400","#e0a52a","#6b8e23","#2e8b57","#3a7ca5","#5b4b8a","#8e44ad","#b0567a","#7f8c8d"];
    let missesAfterChurn=0;
    for(const scale of [1,2,4]) for(const color of colors) for(const eyes of [false,true]) for(let pose=1;pose<=32;pose++) {
      Art.setArtScale(scale);
      if(!Art.drawTraveler(g,color,eyes,false,pose,1))missesAfterChurn++;
    }
    window.Image=NativeImage;
    return{unique:new Set(hashes).size,missing,mirrored,newImages,missesAfterChurn};
  });
  assert.deepEqual(result.missing,[],"no missing first-use poses");assert.ok(result.unique>=28,`32-phase gait must have >=28 distinct leg poses, got ${result.unique}`);assert.ok(result.mirrored,"turning is synchronous");
  assert.equal(result.newImages,0,"pose-cache eviction must not restart SVG decoding");
  assert.equal(result.missesAfterChurn,0,"no dropped figure after 1,920 pose/density variants");
  console.log(`WALK_POSES_OK: ${result.unique}/32 poses, synchronous turn/4x zoom, no misses or SVG decodes after cache churn`);
}finally{await browser.close();}
