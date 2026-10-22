// Each chapter has its own silhouette. These are composition guides, not
// simulated geometry or manufacturing evidence.
export const chapterContours={
 material:['M0 257H620C740 257 775 130 940 0','M0 334H655C755 334 810 180 1020 0','M0 630H680C830 630 895 860 1160 875H1672','M0 730H680C830 730 895 900 1160 908H1672'],
 elements:['M0 240H360C550 240 585 70 790 105S1160 225 1672 130','M0 640H370C610 640 715 835 1050 835S1420 890 1672 865'],
 song:['M0 240H440C625 240 655 125 870 125S1130 240 1672 240','M0 640H440C635 640 710 810 1080 810S1410 680 1672 680'],
 combat:['M0 240H620C745 240 850 230 1030 230C1110 230 1100 75 1195 75C1280 75 1270 210 1370 210H1672','M0 640H550C640 640 590 880 700 880C870 880 990 830 1150 850S1430 900 1672 900'],
 scenes:['M0 272.89H167.2C267.52 272.89 300.96 178.79 459.8 188.2C635.36 188.2 635.36 9.41 836 18.82L1672 0','M0 710H290C325 710 340 690 342.76 639.88C367.84 733.98 618.64 715.16 785.84 941']
};
export function contourMarkup(key){const paths=chapterContours[key];return paths?`<g fill="none" stroke="currentColor" stroke-width="2.5">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`:null;}
export function materialCameraPose(t){return {height:1.65-.08*t,target:[-.15,.35,.4],eye:[5,10,18],center:[.98,.85]};}
// Measured from the approved seven-chapter board, not the previous browser.
// Keep cap height independent of word length: long titles are condensed, not shrunk.
export const chapterTitles={light:[.055,.365,.275,.295],material:[.06,.37,.35,.295],elements:[.002,.35,.52,.34],song:[.055,.38,.235,.33],combat:[.06,.38,.325,.32],scenes:[.035,.37,.26,.32]};
export function titleMarkup(label){return `<svg viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><text x="0" y="98" textLength="500" lengthAdjust="spacingAndGlyphs" font-family="Impact,sans-serif" font-size="122" fill="currentColor">${label}</text></svg>`;}
export const chapterClipDefs=`<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
<clipPath id="reference27-material-clip" clipPathUnits="objectBoundingBox"><path d="M.57 0H1V.93H.73C.6 .93 .55 .67 .47 .65V.36C.50 .36 .53 .13 .57 0Z"/></clipPath>
<clipPath id="reference27-scene-clip" clipPathUnits="objectBoundingBox"><path d="M.50 .02C.38 .01 .38 .20 .275 .20C.18 .19 .16 .29 .10 .29L.19 .34C.23 .40 .20 .57 .205 .68C.22 .78 .37 .76 .47 1H1V0Z"/></clipPath>
</defs></svg>`;
