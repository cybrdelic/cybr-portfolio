export function eventScoreMarkup(score){
 let html='';const span=Math.max(...score.notes.map(n=>n.off))/3;
 for(let staff=0;staff<3;staff++)for(let line=0;line<5;line++){
  const y=65+staff*145+line*13;
  html+=`<path data-staff-y="${y}" d="M0 ${y}H1200" fill="none" stroke="currentColor" stroke-width="1.25"/>`;
 }
 for(const note of score.notes){
  const staff=Math.min(2,Math.floor(note.on/span)),x=35+(note.on-staff*span)/span*1120;
  const match=/^([A-G])([#b]?)(-?\d+)$/.exec(note.pitch||'');
  const step=match?Number(match[3])*7+'CDEFGAB'.indexOf(match[1]):30;
  const y=117+staff*145-(step-30)*6.5;
  html+=`<g data-x="${x}" data-on="${note.on}" data-off="${note.off}"><ellipse cx="${x}" cy="${y}" rx="8" ry="5.5" transform="rotate(-20 ${x} ${y})" fill="currentColor"/><path d="M${x+7} ${y}v-43" stroke="currentColor" stroke-width="1.6"/></g>`;
 }
 return html;
}
