// A source-derived melody/guitar excerpt. Pitches use diatonic staff steps;
// note duration uses score quarters, not audio release tails.
export function scoreMarkup(score){
 const notes=score.notes.filter(n=>(n.staff===1||n.staff===3)&&n.quarter<8),end=8;
 let svg='';
 for(let staff=0;staff<2;staff++){
  const top=110+staff*200;
  for(let l=0;l<5;l++)svg+=`<path d="M0 ${top+l*16}H1200" stroke="currentColor" stroke-width="1.5" fill="none"/>`;
  svg+=`<text x="8" y="${top+63}" font-size="100" font-family="Segoe UI Symbol,serif">𝄞</text>`;
  for(let q=0;q<=end;q+=4){const x=90+q/end*1080;svg+=`<path d="M${x} ${top}v64" stroke="currentColor" stroke-width="1.3"/>`;}
 }
 for(const n of notes){
  const staff=n.staff===3?1:0,top=110+staff*200,pitch=/^([A-G])([#b]?)(-?\d+)$/.exec(n.pitch);if(!pitch)continue;
  const step=Number(pitch[3])*7+'CDEFGAB'.indexOf(pitch[1]),y=top+64-(step-(4*7+2))*8,x=100+n.quarter/end*1070,d=n.quarter_off-n.quarter,open=d>=2,stem=d<4;
  let marks=`<ellipse cx="${x}" cy="${y}" rx="10" ry="6.5" transform="rotate(-20 ${x} ${y})" fill="${open?'var(--paper)':'currentColor'}" stroke="currentColor" stroke-width="2.3"/>`;
  if(stem)marks+=`<path d="M${x+9} ${y}v-48" stroke="currentColor" stroke-width="2"/>`;
  if(d<1)marks+=`<path d="M${x+9} ${y-48}q22 12 9 30q8-15-9-19" fill="currentColor"/>`;
  if(pitch[2])marks+=`<text x="${x-25}" y="${y+7}" font-size="24">${pitch[2]}</text>`;
  for(let ly=top-16;ly>=y;ly-=16)marks+=`<path d="M${x-15} ${ly}h30" stroke="currentColor" stroke-width="1.5"/>`;
  for(let ly=top+80;ly<=y;ly+=16)marks+=`<path d="M${x-15} ${ly}h30" stroke="currentColor" stroke-width="1.5"/>`;
  svg+=`<g data-x="${x}" data-on="${n.on}" data-off="${n.off}">${marks}</g>`;
 }
 // The outlined echo sits in the inter-staff gap, never over source notes.
 svg+='<text x="300" y="295" textLength="350" lengthAdjust="spacingAndGlyphs" font-family="Impact,sans-serif" font-size="105" fill="var(--paper)" stroke="currentColor" stroke-width="1.5">SONG</text>';
 return svg;
}
