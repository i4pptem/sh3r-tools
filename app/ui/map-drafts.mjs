export const mapEditDefaults = part => ({part, translation: [0,0,0], rotation: [0,0,0], scale: [1,1,1], uvOffset: [0,0], uvScale: [1,1], materialGroup: null});
const clone = value => structuredClone(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

/** Own per-map preview state and coalesce a drag or numeric edit into one undo step. */
export class MapDrafts {
  constructor(changed = () => {}) {this.maps = new Map(); this.histories = new Map(); this.changed = changed; this.transaction = null;}
  get count() {return [...this.maps.values()].reduce((sum,map)=>sum+map.edits.size,0);}
  edits(key) {return [...(this.maps.get(key)?.edits.values() || [])].map(clone);}
  get(key,part) {return clone(this.maps.get(key)?.edits.get(part) || mapEditDefaults(part));}
  canUndo(key) {return !!this.histories.get(key)?.length || (this.transaction?.key===key && !equal(this.transaction.before,this.edits(key)));}
  begin(key) {this.end(); this.transaction={key,hash:this.maps.get(key)?.hash,before:this.edits(key)};}
  record(key,hash,before) {const history=this.histories.get(key)||[];history.push({hash,before});if(history.length>100)history.shift();this.histories.set(key,history);}
  end() {
    const transaction=this.transaction;this.transaction=null;
    if(transaction && !equal(transaction.before,this.edits(transaction.key))) this.record(transaction.key,this.maps.get(transaction.key)?.hash ?? transaction.hash,transaction.before);
  }
  set(key,hash,edit) {this.setMany(key,hash,[edit]);}
  setMany(key,hash,edits) {
    const before=this.edits(key),map=this.maps.get(key)||{hash,edits:new Map()};
    if(map.hash!==hash) throw new Error('Map changed. Discard its preview edits before continuing.');
    const next=new Map(map.edits);
    for(const edit of edits) {
      for(const [field,count] of [['translation',3],['rotation',3],['scale',3],['uvOffset',2],['uvScale',2]])
        if(!Array.isArray(edit[field]) || edit[field].length!==count || !edit[field].every(Number.isFinite)) throw new Error('Enter finite transform values.');
      if(!edit.scale.every(v=>v>0)) throw new Error('Scale must be positive.');
      if(equal(edit,mapEditDefaults(edit.part))) next.delete(edit.part);else next.set(edit.part,clone(edit));
    }
    if(next.size)this.maps.set(key,{hash,edits:next});else this.maps.delete(key);
    if(this.transaction?.key!==key && !equal(before,this.edits(key)))this.record(key,hash,before);
    this.changed(this.count);
  }
  undo(key) {
    this.end();const previous=this.histories.get(key)?.pop();if(!previous)return false;
    if(previous.before.length)this.maps.set(key,{hash:previous.hash,edits:new Map(previous.before.map(edit=>[edit.part,edit]))});else this.maps.delete(key);
    this.changed(this.count);return true;
  }
  discard(key) {this.end();const before=this.edits(key);if(before.length)this.record(key,this.maps.get(key).hash,before);this.maps.delete(key);this.changed(this.count);}
  clear(key) {if(this.transaction?.key===key)this.transaction=null;this.maps.delete(key);this.histories.delete(key);this.changed(this.count);}
}
