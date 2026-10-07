async(page)=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('http://127.0.0.1:4173/portfolio/instrument-3d.html?cartridges=1&bake-author=1');
 await page.waitForFunction(()=>window.instrument3D?.exportBakePose,null,{timeout:60000});
 const data=await page.evaluate(()=>{
  const positions=[0,.035,.08,.13,.18,.23,.28,.31,.34,.37,.40,.43,.46];
  for(let i=1;i<=32;i++)positions.push(.46+.44*i/32);
  positions.push(.925,.95,.975,1);
  return {version:2,aspect:1.6,assembly:'instrument-cartridges-v1',frames:positions.map(p=>window.instrument3D.exportBakePose(p))};
 });
 const download=page.waitForEvent('download');
 await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download='cartridge-path.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},data);
 await (await download).saveAs('D:/CYBR-build/exploded-instrument/cartridge-path-v2/path.json');
 await page.evaluate(()=>window.instrument3D.setProgress(0));
 return {frames:data.frames.length,path:'D:/CYBR-build/exploded-instrument/cartridge-path-v2/path.json'};
}
