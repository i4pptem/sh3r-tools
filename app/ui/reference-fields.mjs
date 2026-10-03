import {normalizedCamera} from '../../core/camera-study.mjs';
import {hasFixedDirection} from '../../core/camera-orientation.mjs';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};

/** Native properties operate on the selected record; group geometry edits have separate controls. */
export function referenceFields(host,kind,{begin,end,read,write}) {
  const panel=node('details');panel.append(node('summary',kind==='cam'?'Camera behavior':'Surface properties'));host.append(panel);const fields=[];
  function field(label,count,get,set,{integer=false,available=()=>true}={}) {
    const row=node('label',label);row.className='map-fields';row.style.gridTemplateColumns=`minmax(85px,1fr) repeat(${count},minmax(0,1fr))`;row.dataset.mapTransform='';const inputs=[];
    for(let i=0;i<count;i++) {
      const input=node('input');input.type='number';input.step=integer?'1':'any';input.setAttribute('aria-label',`${kind.toUpperCase()} ${label}${count>1?' '+(i+1):''}`);row.append(input);inputs.push(input);
      input.onfocus=begin;input.onblur=end;input.onchange=()=>{if(inputs.some(el=>el.value===''||!el.validity.valid))return;const record=read();set(record,inputs.map(el=>Number(el.value)));write(record);};
    }
    panel.append(row);fields.push({row,inputs,get,available});
  }
  function property(name,label,count=1,integer=false) {field(label,count,r=>count===1?[r[name]]:r[name],(r,v)=>r[name]=count===1?v[0]:v,{integer,available:r=>r[name]!==undefined});}
  if(kind==='cam') {
    for(const [axis,index] of [['Pitch °',0],['Yaw °',1]])field(axis,1,r=>[normalizedCamera(r).movementParameters[index]*180/Math.PI],(r,v)=>r.movementParameters[index]=v[0]*Math.PI/180,{available:hasFixedDirection});
    property('cameraMovementType','Movement mode',1,true);property('watchHeightOffset','Watch height offset');property('traceBottomHeight','Trace bottom height');property('projection','Projection',3);property('movementParameters','Movement parameters',4);
    panel.append(Object.assign(node('p','Fixed-angle modes 2/7 support Pitch / Yaw and Rotate view. Mode 6 tracks the reference character automatically. Raw movement parameters use radians; keep unknown mode values unchanged.'),{className:'hint'}));
  } else {property('material','Material ID',1,true);property('radius','Cylinder radius');property('topY','Cylinder top Y');}
  return {refresh(record,disabled){for(const field of fields){field.row.hidden=!record||!field.available(record);field.inputs.forEach((input,i)=>{input.disabled=disabled;input.dataset.unavailable=String(disabled);if(!field.row.hidden&&document.activeElement!==input)input.value=field.get(record)[i];});}}};
}
