export const rgbToHex=color=>'#'+color.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
export function hexToRgb(value){
  let hex=value.replace(/^#/,'');if(hex.length===3)hex=[...hex].map(c=>c+c).join('');
  if(!/^[a-f\d]{6}$/i.test(hex))throw new Error('Choose a valid liquid colour');
  return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
}

export function randomPalette(count=3,random=Math.random){
  const start=random();
  return Array.from({length:count},(_,i)=>{
    const hue=(start+i/count+(random()-0.5)*0.06+1)%1,saturation=0.68+random()*0.2,value=0.8+random()*0.18;
    return [5,3,1].map(n=>{const k=(n+hue*6)%6;return value*(1-saturation*Math.max(0,Math.min(k,4-k,1)));});
  });
}
