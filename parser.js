import Tesseract from 'tesseract.js';import sharp from 'sharp';
export async function ocr(buf){const p=await sharp(buf).resize({width:1600}).grayscale().normalize().png().toBuffer();return(await Tesseract.recognize(p,'eng')).data.text}
export function parse(t){const s=[...t.matchAll(/\b([0-5])\s*[-:]\s*([0-5])\b/g)].map(m=>({scoreFor:+m[1],scoreAgainst:+m[2]})).find(x=>x.scoreFor===5||x.scoreAgainst===5);const k=[...t.matchAll(/\b(\d{1,2})\s*[|•·/]\s*(\d{1,2})\s*[|•·/]\s*(\d{1,2})\b/g)][0];return{score:s,kda:k?{kills:+k[1],deaths:+k[2],assists:+k[3]}:null}}
