const PI=Math.PI,TAU=PI*2,DEG=PI/180;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(direction){
 if(!direction||direction.length!==3||direction.some(value=>!Number.isFinite(value)))throw Error('Studio radiance requires a finite three-component direction');
 const length=Math.hypot(...direction);if(length<=0)throw Error('Studio radiance direction must be nonzero');return direction.map(value=>value/length);
}
const smoothstep=(a,b,value)=>{const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);};
const authoredPanels=[
 {name:'key',direction:[-.55,-.72,1.1],widthDeg:26,heightDeg:76,radiance:6,edgeDeg:9},
 {name:'secondary',direction:[.75,.4,.65],widthDeg:24,heightDeg:66,radiance:.95,edgeDeg:9},
 {name:'rim',direction:[-.2,.95,.6],widthDeg:14,heightDeg:76,radiance:3.5,edgeDeg:6},
 {name:'face gradient',direction:[-1,.55,.05],widthDeg:36,heightDeg:70,radiance:.85,edgeDeg:16},
 {name:'front',direction:[1,-1,.15],widthDeg:32,heightDeg:50,radiance:.28,edgeDeg:12},
 {name:'lower bounce',direction:[0,.6,-.8],widthDeg:95,heightDeg:40,radiance:.16,edgeDeg:14},
];
const negativeFill={direction:[-.8,.05,-.3],widthDeg:70,heightDeg:70,edgeDeg:12,roomFactor:.22};
function angularPanel(panel){
 const normal=unit(panel.direction),right=unit(cross(normal,[0,0,1])),up=unit(cross(right,normal));
 return{...panel,normal,right,up,halfWidth:panel.widthDeg*DEG/2,halfHeight:panel.heightDeg*DEG/2,edge:panel.edgeDeg*DEG};
}
const panels=authoredPanels.map(angularPanel),negative=angularPanel(negativeFill);
function coverage(panel,direction){
 const forward=dot(direction,panel.normal);if(forward<=0)return 0;
 const horizontal=Math.abs(Math.atan2(dot(direction,panel.right),forward));
 const vertical=Math.abs(Math.atan2(dot(direction,panel.up),forward));
 return(1-smoothstep(panel.halfWidth-panel.edge,panel.halfWidth,horizontal))*(1-smoothstep(panel.halfHeight-panel.edge,panel.halfHeight,vertical));
}
export const STUDIO_ENVIRONMENT_METADATA=Object.freeze({
 schema:'cybr-sculptural-studio-radiance-v5',width:1024,height:512,format:'linear RGBA float32, bottom-up',nominalIntensity:1,
 orientation:'identity rotation; world +Z up',mapping:'u=atan2(z,x)/(2*pi)+0.5; v=asin(y)/pi+0.5',
 room:Object.freeze({floor:.025,horizon:.06,ceiling:.11}),
 panels:Object.freeze(authoredPanels.map(panel=>Object.freeze({...panel,direction:Object.freeze([...panel.direction])}))),
 negativeFill:Object.freeze({...negativeFill,direction:Object.freeze([...negativeFill.direction])}),
 radianceComposition:'soft rectangular emission cards over neutral room radiance; overlapping cards use the brighter surface',
 source:'authored procedural studio radiance; no baked object appearance',
});

// The panorama uses Three's +Y equirectangular latitude convention. Its
// radiance is authored in world coordinates, where the instrument is +Z up.
export function studioDirectionFromUv(u,v){
 const longitude=(u-.5)*TAU,latitude=(v-.5)*PI,cosLatitude=Math.cos(latitude);
 return[Math.cos(longitude)*cosLatitude,Math.sin(latitude),Math.sin(longitude)*cosLatitude];
}
export function studioUvFromDirection(direction){
 const d=unit(direction);return[Math.atan2(d[2],d[0])/TAU+.5,Math.asin(Math.max(-1,Math.min(1,d[1])))/PI+.5];
}
function sampleUnitRadiance(d){
 const {floor,horizon,ceiling}=STUDIO_ENVIRONMENT_METADATA.room;
 let room=d[2]>=0?horizon+(ceiling-horizon)*smoothstep(0,1,d[2]):floor+(horizon-floor)*smoothstep(-1,0,d[2]);
 room*=1-(1-negative.roomFactor)*coverage(negative,d);
 let radiance=room;
 for(const panel of panels)radiance=Math.max(radiance,room+(panel.radiance-room)*coverage(panel,d));
 return radiance;
}
export function sampleStudioRadiance(direction){const radiance=sampleUnitRadiance(unit(direction));return[radiance,radiance,radiance];}
export function createStudioEnvironment(THREE){
 const{width,height}=STUDIO_ENVIRONMENT_METADATA,data=new Float32Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const value=sampleUnitRadiance(studioDirectionFromUv((x+.5)/width,(y+.5)/height)),offset=(y*width+x)*4;
  data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=1;
 }
 const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
 texture.name='CYBR sculptural studio radiance';texture.mapping=THREE.EquirectangularReflectionMapping;
 texture.colorSpace=THREE.LinearSRGBColorSpace;texture.flipY=false;texture.generateMipmaps=true;
 texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
 texture.userData.studioEnvironment=STUDIO_ENVIRONMENT_METADATA;texture.needsUpdate=true;
 return texture;
}
