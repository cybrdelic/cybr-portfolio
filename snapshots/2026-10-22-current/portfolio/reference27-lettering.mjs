// Authored vector lettering, not a bitmap of the generated reference.
// A narrow technical alphabet keeps navigation consistent across platforms.
const glyphs={
 A:'M0 28 4 0 8 28M1.5 19H6.5',B:'M0 28V0H4Q8 0 8 6V8Q8 14 4 14H0M4 14Q8 14 8 20V22Q8 28 4 28Z',
 C:'M8 5Q8 0 4 0T0 5V23Q0 28 4 28T8 23',D:'M0 0H3Q8 0 8 6V22Q8 28 3 28H0Z',
 E:'M8 0H0V28H8M0 14H6',F:'M8 0H0V28M0 14H6',G:'M8 5Q8 0 4 0T0 5V23Q0 28 4 28T8 23V15H4',
 H:'M0 0V28M8 0V28M0 14H8',I:'M4 0V28',K:'M0 0V28M8 0 0 14 8 28',L:'M0 0V28H8',M:'M0 28V0L4 16 8 0V28',
 N:'M0 28V0L8 28V0',O:'M4 0Q0 0 0 5V23Q0 28 4 28T8 23V5Q8 0 4 0Z',
 R:'M0 28V0H4Q8 0 8 6V8Q8 14 4 14H0M4 14 8 28',S:'M8 5Q8 0 4 0T0 5V8Q0 12 4 14T8 20V23Q8 28 4 28T0 23',
 T:'M-1 0H9M4 0V28',U:'M0 0V23Q0 28 4 28T8 23V0',W:'M0 0 2 28 5 10 8 28 10 0',Y:'M0 0 4 13 8 0M4 13V28',
 '/':'M1 28 7 0'
};
export function technicalLettering(text,{bold=false}={}){
 const step=bold?22:17,width=(text.length-1)*step+12;
 const paths=[...text].map((c,i)=>`<path transform="translate(${i*step+2} 2)" d="${glyphs[c]||''}"/>`).join('');
 return `<svg class="reference-lettering" aria-hidden="true" viewBox="0 0 ${width} 32" style="--lettering-ratio:${width}/32" fill="none" stroke="currentColor" stroke-width="${bold?3:1.65}" stroke-linejoin="round">${paths}</svg>`;
}
export const geoLettering=`<svg class="geo-lettering" viewBox="0 0 362 299" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">
 <path d="M60 0C17 0 0 47 0 149.5S17 299 60 299C99 299 113 264 113 211V136H56V177H75V226C75 245 71 253 62 253C48 253 43 223 43 149.5S48 49 62 49C73 49 76 69 76 106H113C113 36 98 0 60 0Z"/>
 <path d="M145 0H222V43H185V126H214V171H185V256H222V299H145Z"/>
 <path fill-rule="evenodd" d="M306 0C264 0 249 49 249 149.5S264 299 306 299S362 250 362 149.5S348 0 306 0ZM306 49C293 49 290 76 290 149.5S293 250 306 250S321 223 321 149.5S319 49 306 49Z"/>
</svg>`;
