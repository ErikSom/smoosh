export class Camera2D {
  constructor(){this.width=1;this.height=1;this.zoom=1;this.center={x:16,y:10};this.transform=new Float32Array(4);}
  reset(domain){this.domain=domain;this.center.x=domain.origin[0]+domain.width/2;this.center.y=domain.origin[1]+domain.height/2;this.zoom=1;this.update();}
  resize(width,height){this.width=width;this.height=height;this.update();}
  update(){
    if(!this.domain)return;
    const d=this.domain;
    this.scale=Math.min(this.width/d.width,this.height/d.height)*this.zoom;
    this.tx=this.width/2-this.center.x*this.scale;this.ty=this.height/2+this.center.y*this.scale;
    this.transform.set([d.width*this.scale/this.width,d.height*this.scale/this.height,
      (d.origin[0]+d.width/2-this.center.x)*this.scale*2/this.width,
      (d.origin[1]+d.height/2-this.center.y)*this.scale*2/this.height]);
  }
  apply(ctx){ctx.translate(this.tx,this.ty);ctx.scale(this.scale,-this.scale);}
  point(event,rect){return this.world((event.clientX-rect.left)/rect.width*this.width,(event.clientY-rect.top)/rect.height*this.height);}
  world(x,y){return {x:(x-this.tx)/this.scale,y:(this.ty-y)/this.scale};}
  screen(x,y){return {x:this.tx+x*this.scale,y:this.ty-y*this.scale};}
  pan(dx,dy){this.center.x-=dx/this.scale;this.center.y+=dy/this.scale;this.update();}
  zoomAt(factor,x,y){
    const before=this.world(x,y);this.zoom=Math.max(0.35,Math.min(12,this.zoom*factor));this.update();
    const after=this.world(x,y);this.center.x+=before.x-after.x;this.center.y+=before.y-after.y;this.update();
  }
  bind(canvas,{isPanTool,onChange,onCancel}){
    const pointers=new Map();let gesture=false,last;
    const pixel=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*this.width/r.width,y:(e.clientY-r.top)*this.height/r.height};};
    const average=()=>{const p=[...pointers.values()];return {x:(p[0].x+p.at(-1).x)/2,y:(p[0].y+p.at(-1).y)/2,d:p.length>1?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0};};
    canvas.addEventListener('pointerdown',e=>{
      pointers.set(e.pointerId,pixel(e));
      if(pointers.size>1||isPanTool()||e.button===1){gesture=true;last=average();onCancel();canvas.setPointerCapture(e.pointerId);e.stopImmediatePropagation();e.preventDefault();}
    },true);
    canvas.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,pixel(e));
      if(!gesture)return;const next=average();
      if(next.d>0&&last.d>0)this.zoomAt(next.d/last.d,last.x,last.y);
      this.pan(next.x-last.x,next.y-last.y);last=next;onChange();e.stopImmediatePropagation();e.preventDefault();
    },true);
    for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,e=>{
      pointers.delete(e.pointerId);if(gesture){e.stopImmediatePropagation();if(pointers.size)last=average();else gesture=false;}
    },true);
    canvas.addEventListener('wheel',e=>{const p=pixel(e);this.zoomAt(Math.exp(-e.deltaY*0.0015),p.x,p.y);onChange();e.preventDefault();},{passive:false});
  }
}
