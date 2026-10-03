export const mapEditDefaults = part => ({part, translation: [0,0,0], rotation: [0,0,0], scale: [1,1,1], uvOffset: [0,0], uvScale: [1,1], materialGroup: null});
const clone = value => structuredClone(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const recordId = record => `${record.group ?? ''}:${record.index}`;

/** Own all unapplied room edits and coalesce each gesture into one shared undo step. */
export class MapDrafts {
  constructor(changed = () => {}) {this.maps = new Map(); this.histories = new Map(); this.failures = new Map(); this.changed = changed; this.transaction = null;}
  get count() {return [...this.maps.values()].reduce((sum,map)=>sum+map.edits.length+map.references.reduce((n,ref)=>n+ref.records.length,0),0);}
  snapshot(key) {return clone(this.maps.get(key) || {hash:null,edits:[],references:[]});}
  edits(key) {return this.snapshot(key).edits;}
  references(key) {return this.snapshot(key).references;}
  reference(key,target) {return this.references(key).find(ref=>ref.target===target);}
  get(key,part) {return this.edits(key).find(edit=>edit.part===part) || mapEditDefaults(part);}
  canUndo(key) {return !!this.histories.get(key)?.length || (this.transaction?.key===key && !equal(this.transaction.before,this.snapshot(key)));}
  begin(key) {this.end(); this.transaction={key,before:this.snapshot(key)};}
  record(key,before) {const history=this.histories.get(key)||[];history.push(before);if(history.length>100)history.shift();this.histories.set(key,history);}
  end() {const transaction=this.transaction;this.transaction=null;if(transaction && !equal(transaction.before,this.snapshot(transaction.key)))this.record(transaction.key,transaction.before);}
  failure(key,message) {if(this.maps.has(key))this.failures.set(key,message);}
  pending(entries=[]) {return [...this.maps.keys()].map(key=>({key,name:entries.find(entry=>entry.key===key)?.name||key,error:this.failures.get(key)||null}));}
  commit(key,before,next) {
    if(!equal(before,next))this.failures.delete(key);
    if(!next.edits.length && !next.references.length)this.maps.delete(key);else this.maps.set(key,next);
    if(this.transaction?.key!==key && !equal(before,this.snapshot(key)))this.record(key,before);
    this.changed(this.count);
  }
  set(key,hash,edit) {this.setMany(key,hash,[edit]);}
  setMany(key,hash,edits) {
    const before=this.snapshot(key), next=clone(before);
    if(next.hash && next.hash!==hash)throw new Error('Map changed. Discard its preview edits before continuing.');
    next.hash=hash;
    for(const edit of edits) {
      for(const [field,count] of [['translation',3],['rotation',3],['scale',3],['uvOffset',2],['uvScale',2]])
        if(!Array.isArray(edit[field]) || edit[field].length!==count || !edit[field].every(Number.isFinite))throw new Error('Enter finite transform values.');
      if(!edit.scale.every(v=>v>0))throw new Error('Scale must be positive.');
      next.edits=next.edits.filter(previous=>previous.part!==edit.part);
      if(!equal(edit,mapEditDefaults(edit.part)))next.edits.push(clone(edit));
    }
    this.commit(key,before,next);
  }
  setReference(key,mapHash,world,kind,record,original) {this.setReferences(key,mapHash,world,kind,[record],[original]);}
  setReferences(key,mapHash,world,kind,records,originals) {
    const before=this.snapshot(key),next=clone(before);
    if(next.hash && next.hash!==mapHash)throw new Error('Map changed. Discard its preview edits before continuing.');
    next.hash=mapHash;
    let ref=next.references.find(item=>item.target===world.key);
    if(ref && ref.hash!==world.hash)throw new Error('Reference file changed. Discard its preview edits before continuing.');
    if(!ref){ref={target:world.key,hash:world.hash,kind,records:[]};next.references.push(ref);}
    const sources=new Map(originals.map(record=>[recordId(record),record])),updates=new Map(ref.records.map(record=>[recordId(record),record]));
    for(const record of records) {
      const id=recordId(record),original=sources.get(id);
      if(!original)throw new Error('Select an existing reference record.');
      if(equal(record,original))updates.delete(id);else updates.set(id,clone(record));
    }
    ref.records=[...updates.values()];
    next.references=next.references.filter(item=>item.records.length);
    this.commit(key,before,next);
  }
  undo(key) {this.end();this.failures.delete(key);const previous=this.histories.get(key)?.pop();if(!previous)return false;if(previous.edits.length||previous.references.length)this.maps.set(key,previous);else this.maps.delete(key);this.changed(this.count);return true;}
  discard(key) {this.end();this.failures.delete(key);const before=this.snapshot(key);if(this.maps.has(key))this.record(key,before);this.maps.delete(key);this.changed(this.count);}
  clear(key) {this.failures.delete(key);if(this.transaction?.key===key)this.transaction=null;this.maps.delete(key);this.histories.delete(key);this.changed(this.count);}
}
