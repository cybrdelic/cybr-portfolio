export const designs={
 '04':{name:'Type Stage',center:[.33,.64],height:13.3,red:false},
 '05':{name:'Optical Field',center:[.33,.46],height:12.2,red:false},
 '11':{name:'Shadow Choreography',center:[.69,.48],height:11.5,red:true},
 '14':{name:'Light as the Event',center:[.65,.46],height:12.5,red:true},
 '27':{name:'Neutral Actuated Canvas',center:[.68,.48],height:11.5,red:false}
};
export const chapters=[
 {key:'geo',name:'GEO',title:'Mechanical systems,\nmade visible.',event:'Geometry\ncontrols the light.',description:'One pinion. One cam ring. Eight overlapping leaves.',url:'geo.html'},
 {key:'light',name:'LIGHT',title:'A world,\nresolved.',event:'Light\nshapes perception.',description:'The same geometry meets the photographic studio.',url:'light.html'},
 {key:'material',name:'MATERIAL',title:'A surface,\nnot a color.',event:'Material\ngives it character.',description:'Authored metal finishes, mapped at physical scale.',url:'material-repair.html'},
 {key:'elements',name:'ELEMENTS',title:'Force leaves\na trace.',event:'Elements\nmove through it.',description:'The original FLIP surface follows a lateral impulse.',url:'elements.html'},
 {key:'song',name:'SONG',title:'Motion finds\na meter.',event:'Song\nshapes the rhythm.',description:'Lantern Steps. Piano and guitar. Thirty-three note events.',url:'song.html'},
 {key:'combat',name:'COMBAT',title:'Timing becomes\na strike.',event:'Combat\ntests the form.',description:'The actual mannequin performs its recorded step-in cross.',url:'combat.html'},
 {key:'scenes',name:'SCENES',title:'A world\nbeyond the lens.',event:'Scenes\ntake it further.',description:'Desert Hot Springs. Source geometry, not a replacement diorama.',url:'scenes.html'}
];
export const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
export function journeyState(progress){const t=clamp(progress)*7,index=Math.min(6,Math.floor(t));return {index,key:chapters[index].key,local:clamp(t-index),progress:clamp(progress)};}
