import { Pane } from '../vendor/tweakpane/tweakpane.min.js';
import { SCENE_GROUPS } from './scenes.mjs';
const tools={'Stir / grab':'stir','Pan view':'pan','Paint material':'paint',Rectangle:'box',Circle:'circle',Polygon:'polygon',Emitter:'emitter',Drain:'drain',Erase:'erase','Static obstacle':'obstacle','Dynamic body':'body','Select / move':'select','Simulation area':'area'};
const materials={Water:'water',Syrup:'syrup',Rubber:'rubber',Sand:'sand',Putty:'putty'};
export function createGui(state,actions){
  const pane=new Pane({title:'Smoosh',expanded:false,container:document.getElementById('gui')});
  const tabs=pane.addTab({pages:[{title:'Simulation'},{title:'Samples'}]});
  const simulation=tabs.pages[0],samples=tabs.pages[1],bindings=new Map();
  const bind=(folder,key,options,change)=>{const b=folder.addBinding(state,key,options);b.element.dataset.control=key;if(change)b.on('change',e=>change(e.value));bindings.set(key,b);return b;};
  bind(simulation,'paused',{label:'Paused'},actions.pause);
  for(const [title,callback]of [['Single step','step'],['Reset scene','reset'],['Clear material','clear'],['Fit view','fit']])simulation.addButton({title}).on('click',actions[callback]);
  const gate=bind(simulation,'gate',{label:'Gate open'},actions.gate);
  const animation=bind(simulation,'animate',{label:'Animate press'},actions.animate);
  const motors=simulation.addFolder({title:'Motors',expanded:true});
  bind(motors,'motors',{label:'Enabled'},actions.motors);
  bind(motors,'motor-speed',{label:'Speed ×',min:-2,max:2,step:0.1},actions.motors);
  motors.addButton({title:'Reverse motors'}).on('click',actions.reverseMotors);
  const drawing=simulation.addFolder({title:'Draw / place',expanded:true});
  bind(drawing,'tool',{label:'Tool',options:tools},actions.tool);bind(drawing,'material',{label:'Material',options:materials},actions.material);
  bind(drawing,'tint',{label:'Colour',view:'color'});
  bind(drawing,'color-mixing',{label:'Liquid mixing / s',min:0,max:10,step:0.1},actions.colorMixing);
  bind(drawing,'touch-push',{label:'Push instead of grab'});
  for(const [key,label,min,max,step]of [['radius','Radius',0.25,5,0.05],['rate','Particles / s',0,100000,100],['velocity-x','Velocity X',-30,30,0.5],['velocity-y','Velocity Y',-30,30,0.5],['body-density','Body density',1,2000,1]])bind(drawing,key,{label,min,max,step});
  bind(drawing,'body-shape',{label:'Body shape',options:{Box:'box',Circle:'circle'}});
  drawing.addButton({title:'Finish polygon'}).on('click',actions.finishPolygon);drawing.addButton({title:'Cancel drawing'}).on('click',actions.cancel);
  const selection=simulation.addFolder({title:'Selected object',expanded:false});let objectBinding;
  bind(selection,'object-x',{label:'X',step:0.1},actions.move);bind(selection,'object-y',{label:'Y',step:0.1},actions.move);bind(selection,'object-enabled',{label:'Enabled'},actions.enabled);
  const apply=selection.addButton({title:'Apply material / source settings'}).on('click',actions.apply),remove=selection.addButton({title:'Delete object'}).on('click',actions.remove);
  const material=simulation.addFolder({title:'Material parameters',expanded:false});
  for(const [key,label,min,max,step]of [['viscosity','Viscosity',0,1,0.005],['elasticity','Elasticity',0,1,0.01],['stiffness','Elastic relaxation',0.01,2,0.05],['plasticity','Plasticity',0,1,0.01],['friction-angle','Sand friction',0,80,1]])bind(material,key,{label,min,max,step},v=>actions.materialParameter(key,v));
  const physics=simulation.addFolder({title:'Physics',expanded:false});bind(physics,'gravity',{label:'Gravity',min:0,max:20,step:0.1},actions.gravity);
  for(const [key,label,options]of [['fluid-hz','Fluid Hz',{60:60,120:120,240:240,480:480}],['solid-hz','Solid minimum Hz',{'Follow fluid':0,120:120,240:240,480:480}],['rigid-hz','Box2D Hz',{30:30,60:60,120:120,240:240}],['quality','Iterations',{3:3,5:5,8:8}]])bind(physics,key,{label,options},v=>actions.physics(key,v));
  bind(physics,'feedback',{label:'Box2D feedback'},actions.feedback);
  const display=simulation.addFolder({title:'Display',expanded:false});bind(display,'view',{label:'View',options:{Particles:'particles',Surface:'surface',Velocity:'velocity'}},actions.view);bind(display,'areas',{label:'Area boundaries'},actions.redraw);
  const performance=simulation.addFolder({title:'Performance',expanded:false});for(const [key,label]of [['particles','Particles'],['bodyCount','Coupled bodies'],['jointCount','Joints'],['gpuMs','Solver GPU ms'],['cpuMs','CPU ms'],['fps','FPS'],['memoryMB','GPU MB'],['time','Simulated seconds']])bind(performance,key,{label,readonly:true});
  for(const [title,entries]of Object.entries(SCENE_GROUPS)){const folder=samples.addFolder({title,expanded:true});for(const [id,title]of entries){const b=folder.addButton({title});b.element.dataset.sample=id;b.on('click',()=>actions.scene(id));}}
  return {pane,tabs,bindings,busy(v){pane.disabled=v;},refresh(){pane.refresh();},scene(name,hasGate,hasMotors=false,hasAnimation=false){pane.title=`Smoosh · ${name}`;gate.hidden=!hasGate;motors.hidden=!hasMotors;animation.hidden=!hasAnimation;},
    objects(records,selected){objectBinding?.dispose();const options={None:''};for(const r of records)options[r.kind==='area'?`area: ${r.areaId}`:r.shape?`${r.kind}: ${r.shape.material} (${r.id})`:r.id]=r.id;objectBinding=bind(selection,'objects',{label:'Object',options,index:0},actions.select);this.selection(selected);},
    selection(r){for(const key of ['object-x','object-y'])bindings.get(key).disabled=!r;bindings.get('object-enabled').disabled=!r||!!r.body;apply.disabled=!r?.shape;remove.disabled=!r;if(pane.expanded)pane.refresh();},
    material(m){bindings.get('elasticity').disabled=m.model===0;bindings.get('stiffness').disabled=m.model===0;bindings.get('plasticity').disabled=m.model!==3;bindings.get('friction-angle').disabled=m.model!==2;pane.refresh();},
    stats(){if(pane.expanded&&performance.expanded)pane.refresh();},
  };
}
