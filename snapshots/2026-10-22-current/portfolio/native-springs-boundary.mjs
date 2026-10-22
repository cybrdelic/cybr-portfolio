// Port of CYBR SCENES spectral_desert.cpp poolQ and its seeded noise.
function hash(x,y){let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+1274126177)>>>0;h=Math.imul(h^(h>>>13),1274126177)>>>0;return (h^(h>>>16))>>>0;}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y);x-=ix;y-=iy;x=x*x*(3-2*x);y=y*y*(3-2*y);let v=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++)v+=(hash(ix+a,iy+b)*2/4294967295-1)*(a?x:1-x)*(b?y:1-y);return v;}
export function sourcePoolQ(x,z,i){const y=-z,[cx,cy,rx,ry]=i?[ -3.5,10,2.2,1.65 ]:[.5,1,4.1,4.05],dx=(x-cx)/rx,dy=(y-cy)/ry,a=Math.atan2(dy,dx);const edge=1+.13*Math.sin(3*a+.55)+.065*Math.sin(2*a-1.3)+.044*Math.sin(7*a+.9*i)+.10*noise(x*.55,y*.55)+.030*noise(x*2.7,y*2.7);let q=Math.hypot(dx,dy)/edge;if(i===0)q+=.18*Math.exp(-(((x-3)/1.3)**2)-((y+.55)/1)**2);return q;}
export function trimWaterInterface(geometry,pool){
 const p=geometry.attributes.position,ix=geometry.index,kept=[];
 for(let k=0;k<(ix?.count||p.count);k+=3){const a=ix?ix.getX(k):k,b=ix?ix.getX(k+1):k+1,c=ix?ix.getX(k+2):k+2;
  const y=(p.getY(a)+p.getY(b)+p.getY(c))/3;if(y<(pool?.245:.055)-.012)continue;
  const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
  if(sourcePoolQ(x,z,pool)<=1.015)kept.push(a,b,c);
 }
 geometry.setIndex(kept);return kept.length/3;
}
