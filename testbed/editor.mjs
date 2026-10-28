import { contains, region } from '../dist/domain.mjs';
import { createBody } from './bodies.mjs';
import {hexToRgb,rgbToHex} from './colors.mjs';

const number = (controls, id) => { const value = Number(controls[id]); if (!Number.isFinite(value)) throw new Error(`${id} must be a number`); return value; };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export const TOOL_HELP = {
  stir:'Drag to grab material; Shift + drag pushes it.', paint:'Drag to paint the selected material.',
  box:'Drag a rectangle of material.', circle:'Drag from the centre to draw a circle of material.',
  polygon:'Click vertices; Enter or double-click closes the polygon. Escape cancels (32 vertices maximum).',
  emitter:'Click to place a source. Drag to aim its velocity. Radius and rate come from the controls.',
  drain:'Click to place a drain.', erase:'Drag to erase material.',
  obstacle:'Drag a static Box2D obstacle.', body:'Drag a dynamic Box2D body.',
  select:'Click an object to select it; drag to move it. Delete removes it.',
  area:'Drag a simulation area. Touching and overlapping areas communicate. Delete the tank area to start a new domain.',
};

export class SandboxEditor {
  constructor(canvas, { controls, camera, onEdit, onAreaChange, onMaterialSelect, onObjectsChange, onSelectionChange, onHelp, notify }) {
    Object.assign(this,{canvas,controls,camera,onEdit,onAreaChange,onMaterialSelect,onObjectsChange,onSelectionChange,onHelp,notify});
    this.records=[];this.pending=[];this.polygon=[];this.counter=0;this.selected=null;
    canvas.addEventListener('pointerdown',event=>this.guard(()=>this.pointerDown(event)));
    canvas.addEventListener('pointermove',event=>this.guard(()=>this.pointerMove(event)));
    canvas.addEventListener('pointerup',event=>this.guard(()=>this.pointerUp(event)));
    canvas.addEventListener('pointercancel',()=>this.cancel());
    canvas.addEventListener('lostpointercapture',()=>{if(this.sim)this.sim.pointer.active=false;});
    this.updateHelp();
  }
  guard(fn){try{return fn();}catch(error){this.notify(error.message);}}
  bind(sim,B,world){
    this.sim=sim;this.B=B;this.world=world;this.records=[];this.pending=[];this.polygon=[];this.selected=null;this.counter=0;this.gesture=null;this.mechanisms=null;
    this.controls.objects='';this.refreshList();
  }
  materialOptions(){return {material:this.controls['material'],rate:number(this.controls,'rate'),velocity:[number(this.controls,'velocity-x'),number(this.controls,'velocity-y')],...(this.controls.tint?{color:hexToRgb(this.controls.tint)}:{})};}
  region(record){return record.kind==='area'?this.sim.domain.areas.get(record.areaId):record.shape;}
  register(kind,data){const r={id:`${kind}-${++this.counter}`,kind,...data};this.records.push(r);this.refreshList();return r;}
  addAreaRecord(areaId){return this.register('area',{areaId});}
  addBodyRecord(body,options={}){return this.register('body',{body,...options});}
  refreshList(){
    for(const r of this.records)if(r.body)r.index=this.sim.adapter.bodies.indexOf(r.body);
    this.onObjectsChange?.();
  }
  setTool(tool){this.cancel();this.controls.tool=tool;this.updateHelp();}
  setEnabled(enabled){
    const r=this.selected;if(!r||r.body)return;
    if(r.kind==='area'){this.sim.domain.updateArea(r.areaId,{enabled});this.onAreaChange();}
    else this.sim.updateShape(r.shape,{enabled});
    this.onEdit();
  }
  applySelected(){if(this.selected?.shape){this.sim.updateShape(this.selected.shape,this.materialOptions());this.onObjectsChange?.();this.onEdit();}}
  position(r){
    if(r.body){const p=this.B.b2Body_GetPosition(r.body);const result={x:p.x,y:p.y};p.delete();return result;}
    const s=this.region(r);return {x:s.x,y:s.y};
  }
  select(record){
    this.selected=record??null;this.controls.objects=record?.id??'';
    if(record){
      const p=this.position(record);this.controls['object-x']=p.x;this.controls['object-y']=p.y;
      this.controls['object-enabled']=record.body?true:this.region(record).enabled;
      if(record.shape){this.controls.material=record.shape.material;this.controls.rate=record.shape.rate;
        this.controls['velocity-x']=record.shape.velocity[0];this.controls['velocity-y']=record.shape.velocity[1];this.onMaterialSelect();if(record.shape.color)this.controls.tint=rgbToHex(record.shape.color);}
    }
    this.onSelectionChange?.();
  }
  place(tool,geometry,options={}){
    geometry=region(geometry);
    const material={...this.materialOptions(),...options};let record;
    if(['box','circle','polygon','paint'].includes(tool))this.sim.pour({...geometry,...material});
    else if(tool==='erase')this.sim.erase(geometry);
    else if(tool==='emitter'||tool==='drain'){
      const shape=tool==='emitter'?this.sim.addEmitter({...geometry,...material}):this.sim.addDrain(geometry);
      record=this.register(tool,{shape});
    }else if(tool==='area'){
      const id=`area-${this.counter+1}`;this.sim.addArea(id,geometry);record=this.addAreaRecord(id);this.onAreaChange();
    }else if(tool==='obstacle'||tool==='body'){
      const circle=geometry.type==='circle',options={
        x:geometry.x+(circle?0:geometry.width/2),y:geometry.y+(circle?0:geometry.height/2),
        width:geometry.width,height:geometry.height,radius:geometry.radius,static:tool==='obstacle',density:number(this.controls,'body-density'),
      };
      if(geometry.type==='polygon')throw new Error('Box2D placement uses boxes or circles');
      if(options.density<1||options.density>2000)throw new Error('Body density must be between 1 and 2,000 kg/m²');
      if(this.sim.adapter.bodyCount>=128)throw new Error('128 registered bodies maximum');
      const body=createBody(this.B,this.world,options);this.sim.adapter.addBody(body);record=this.addBodyRecord(body,options);
    }
    this.onEdit();return record;
  }
  move(r,x,y){
    if(!r)return;
    if(r.body){
      const p=new this.B.b2Vec2(x,y),q=this.B.b2Body_GetRotation(r.body);this.B.b2Body_SetTransform(r.body,p,q);p.delete();q.delete();
      r.animation=null;this.sim.adapter.refresh();
    }else{
      const s=this.region(r),changes=s.type==='polygon'?{points:s.points.map(p=>[p[0]+x-s.x,p[1]+y-s.y])}:{x,y};
      if(r.kind==='area'){this.sim.domain.updateArea(r.areaId,changes);this.onAreaChange();}
      else this.sim.updateShape(s,changes);
    }
    this.controls['object-x']=x;this.controls['object-y']=y;this.onSelectionChange?.();this.onEdit();
  }
  remove(r){
    if(!r)return;
    if(r.body){this.sim.adapter.removeBody(r.body);this.B.b2DestroyBody(r.body);}
    else if(r.kind==='area'){this.sim.domain.removeArea(r.areaId);this.onAreaChange();}
    else this.sim.removeShape(r.shape);
    this.records.splice(this.records.indexOf(r),1);this.select(null);this.refreshList();this.onEdit();
  }
  hit(p){
    for(const r of [...this.records].reverse())if(r.body&&!r.hidden){
      const [gx,gy]=this.sim.domain.toGrid(p.x,p.y),b=4+r.index*12,data=this.sim.adapter.data;
      if(Math.hypot(gx-data[b+2],gy-data[b+3])<Math.sqrt(data[b+11])){
        const aabb=this.B.b2Body_ComputeBounds(r.body);
        const hit=p.x>=aabb.lowerBound.x&&p.x<=aabb.upperBound.x&&p.y>=aabb.lowerBound.y&&p.y<=aabb.upperBound.y;aabb.delete();if(hit)return r;
      }
    }
    for(const r of [...this.records].reverse())if(r.shape&&contains({...r.shape,enabled:true},p.x,p.y))return r;
    for(const r of [...this.records].reverse())if(r.kind==='area'&&contains({...this.region(r),enabled:true},p.x,p.y))return r;
    return null;
  }
  point(event){return this.camera.point(event,this.canvas.getBoundingClientRect());}
  pointerDown(event){
    if(!this.sim||this.disabled||event.button!==0)return;
    this.canvas.focus({preventScroll:true});
    const p=this.point(event),tool=this.controls['tool'];
    try{this.canvas.setPointerCapture(event.pointerId);}catch{}
    if(tool==='polygon'){
      if(!this.polygon.length||distance(p,this.polygon.at(-1))>0.05)this.polygon.push(p);
      if(event.detail===2)this.finishPolygon();else if(this.polygon.length===32)this.finishPolygon();return;
    }
    this.gesture={tool,start:p,current:p,last:p,time:event.timeStamp};
    if(tool==='select'){const r=this.hit(p);this.select(r);if(r)this.gesture.origin=this.position(r);}
    else if(tool==='stir'){Object.assign(this.sim.pointer,{...p,vx:0,vy:0,active:true,mode:event.shiftKey||this.controls['touch-push']?'push':'grab'});}
    else if(tool==='paint'||tool==='erase')this.stamp(p);
  }
  pointerMove(event){
    if(!this.sim||this.disabled)return;const p=this.point(event);this.hover=p;
    const g=this.gesture;if(!g)return;g.current=p;
    if(g.tool==='stir'){
      const dt=Math.max(0.005,(event.timeStamp-g.time)/1000);
      Object.assign(this.sim.pointer,{...p,vx:Math.max(-12,Math.min(12,(p.x-g.last.x)/dt)),vy:Math.max(-12,Math.min(12,(p.y-g.last.y)/dt)),mode:event.shiftKey||this.controls['touch-push']?'push':'grab'});
      g.last=p;g.time=event.timeStamp;
    }else if(g.tool==='paint'||g.tool==='erase'){
      const spacing=number(this.controls,'radius')*1.5,total=distance(g.last,p),count=Math.min(12,Math.floor(total/spacing));
      const start=g.last;
      for(let i=1;i<=count;i++){const t=i*spacing/total;const q={x:start.x+(p.x-start.x)*t,y:start.y+(p.y-start.y)*t};this.stamp(q);g.last=q;}
    }else if(g.tool==='select'&&this.selected&&this.selected.kind!=='area')this.move(this.selected,g.origin.x+p.x-g.start.x,g.origin.y+p.y-g.start.y);
  }
  geometry(g){
    const a=g.start,b=g.current,circle=g.tool==='circle'||(['body','obstacle'].includes(g.tool)&&this.controls['body-shape']==='circle');
    if(circle)return {type:'circle',x:a.x,y:a.y,radius:Math.max(0.25,distance(a,b))};
    return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(0.25,Math.abs(a.x-b.x)),height:Math.max(0.25,Math.abs(a.y-b.y))};
  }
  pointerUp(event){
    const g=this.gesture;if(!g)return;g.current=this.point(event);this.sim.pointer.active=false;
    if(['box','circle','body','obstacle','area'].includes(g.tool))this.place(g.tool,this.geometry(g));
    else if(g.tool==='emitter'||g.tool==='drain'){
      const velocity=distance(g.start,g.current)>0.2?[Math.max(-30,Math.min(30,(g.current.x-g.start.x)*2)),Math.max(-30,Math.min(30,(g.current.y-g.start.y)*2))]:undefined;
      const record=this.place(g.tool,{type:'circle',...g.start,radius:number(this.controls,'radius')},velocity?{velocity}:{});this.select(record);
    }else if(g.tool==='select'&&this.selected?.kind==='area')this.move(this.selected,g.origin.x+g.current.x-g.start.x,g.origin.y+g.current.y-g.start.y);
    this.gesture=null;
  }
  stamp(p){if(this.pending.length<32)this.pending.push({tool:this.gesture.tool,geometry:{type:'circle',...p,radius:number(this.controls,'radius')},options:this.materialOptions()});}
  flush(){
    let count=0;
    while(this.pending.length&&this.sim.shapes.length<64&&count<16){const p=this.pending.shift();this.place(p.tool,p.geometry,p.options);count++;}
    return count;
  }
  finishPolygon(){
    if(this.polygon.length<3){this.notify('A polygon needs at least 3 vertices.');return;}
    this.place('polygon',{type:'polygon',points:this.polygon.map(p=>[p.x,p.y])});this.polygon=[];
  }
  cancel(){if(this.sim)this.sim.pointer.active=false;this.gesture=null;this.polygon=[];}
  updateHelp(){this.onHelp?.(TOOL_HELP[this.controls.tool]??'Two fingers: pan and zoom.');}
  draw(ctx){
    if(!this.sim)return;const d=this.sim.domain,sx=this.camera.scale;
    ctx.save();this.camera.apply(ctx);
    const outline=(r,color)=>{
      ctx.strokeStyle=color;ctx.lineWidth=1/sx;ctx.beginPath();
      if(r.type==='circle')ctx.arc(r.x,r.y,r.radius,0,Math.PI*2);
      else if(r.type==='polygon'){r.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}
      else ctx.rect(r.x,r.y,r.width,r.height);ctx.stroke();
    };
    if(this.controls.areas){
      if(this.boundaryDomain!==d||this.boundaryVersion!==d.version){
        this.boundaryPath=new Path2D();const edges=d.boundarySegments();
        for(let i=0;i<edges.length;i+=4){this.boundaryPath.moveTo(edges[i],edges[i+1]);this.boundaryPath.lineTo(edges[i+2],edges[i+3]);}
        this.boundaryDomain=d;this.boundaryVersion=d.version;
      }
      ctx.strokeStyle='#8191a2';ctx.lineWidth=1.5/sx;ctx.stroke(this.boundaryPath);
    }
    const data=this.sim.adapter.data,cell=d.cellSize;
    for(const r of this.records){
      if(r.hidden)continue;
      if(r.body){
        const b=4+r.index*12,[x,y]=d.toWorld(data[b+2],data[b+3]);ctx.save();ctx.translate(x,y);ctx.rotate(data[b+4]);
        ctx.fillStyle=r.color??(r.static?'#888':r.kinematic?'#c98bd4':'#e8a45d');ctx.strokeStyle=r===this.selected?'#fff':'#bbb';ctx.lineWidth=1/sx;
        for(let j=0;j<data[b+10];j++){
          const at=4+128*12+(data[b+9]+j)*46;ctx.beginPath();
          if(data[at+3]===0)ctx.arc(data[at]*cell,data[at+1]*cell,data[at+2]*cell,0,Math.PI*2);
          else{for(let v=0;v<data[at+5];v++){const x=data[at+6+v*2]*cell,y=data[at+7+v*2]*cell;v?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}
          ctx.fill();ctx.stroke();
        }ctx.restore();
      }else if(r.shape){
        const shape=r.shape;ctx.globalAlpha=shape.enabled?1:0.35;outline(shape,r===this.selected?'#fff':r.kind==='drain'?'#f55':'#7f7');
        const x=shape.x+(shape.type==='circle'?0:shape.width/2),y=shape.y+(shape.type==='circle'?0:shape.height/2);
        ctx.beginPath();ctx.moveTo(x-0.15,y);ctx.lineTo(x+0.15,y);ctx.moveTo(x,y-0.15);ctx.lineTo(x,y+0.15);ctx.stroke();ctx.globalAlpha=1;
      }else if(r===this.selected)outline(this.region(r),'#fff');
    }
    this.mechanisms?.draw(ctx,sx);
    const g=this.gesture;
    if(g&&['box','circle','body','obstacle','area'].includes(g.tool))outline(this.geometry(g),'#fff');
    if(g?.tool==='emitter'){ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(g.start.x,g.start.y);ctx.lineTo(g.current.x,g.current.y);ctx.stroke();}
    if(this.polygon.length){ctx.strokeStyle='#fff';ctx.beginPath();this.polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(this.hover)ctx.lineTo(this.hover.x,this.hover.y);ctx.stroke();}
    if(this.hover&&['paint','erase','emitter','drain'].includes(this.controls['tool']))outline({type:'circle',...this.hover,radius:number(this.controls,'radius')},'#777');
    ctx.restore();
  }
}
