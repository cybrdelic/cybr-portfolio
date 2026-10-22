import * as T from './vendor/three-r180/three.module.min.js';
import {studioGlyphs} from './studio-lettering-outlines.mjs';

// Solid lettering fixed to the room, not projected from the camera or DOM.
export function createStudioLettering(initial='GEO'){
 const root=new T.Group();root.name='Solid studio lettering';
 const material=new T.MeshStandardMaterial({color:0xf1dcb7,roughness:.68,metalness:0});
 const owned=[],cache=new Map();let current;
 function setText(word){
  if(current===word)return;current=word;
  root.children.forEach(child=>child.visible=false);
  if(cache.has(word)){const entry=cache.get(word);entry.meshes.forEach(mesh=>mesh.visible=true);root.scale.setScalar(entry.scale);return;}
  const meshes=[];
  let cursor=0;
  for(const char of word){
   const glyph=studioGlyphs[char],path=new T.ShapePath();
   for(const [op,...p] of glyph.commands){
    if(op==='M')path.moveTo(...p);
    if(op==='L')path.lineTo(...p);
    if(op==='Q')path.quadraticCurveTo(...p);
    if(op==='C')path.bezierCurveTo(...p);
    if(op==='Z')path.currentPath.closePath();
   }
   const geometry=new T.ExtrudeGeometry(path.toShapes(),{depth:.055,bevelEnabled:true,bevelThickness:.004,bevelSize:.003,bevelSegments:1,curveSegments:10});
   const mesh=new T.Mesh(geometry,material);mesh.position.set(cursor,0,0);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);owned.push(geometry);meshes.push(mesh);
   cursor+=glyph.advance-.035;
  }
  const scale=Math.min(1.6,6.5/cursor);root.scale.setScalar(scale);cache.set(word,{meshes,scale});
 }
 root.position.set(-15.8,2.2,-6.20);setText(initial);
 return {root,setText,dispose(){owned.forEach(g=>g.dispose());material.dispose();}};
}
