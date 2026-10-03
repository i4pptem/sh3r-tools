/** CLD has polygon records, so connected surfaces are editor selections, not native objects. */
export class CollisionSelection {
  constructor(records) {
    this.records=records;this.parent=records.map((_,i)=>i);const edges=new Map();
    for(const [index,record] of records.entries())for(const [i,a] of (record.vertices||[]).entries()) {
      const b=record.vertices[(i+1)%record.vertices.length],keys=[a.join(','),b.join(',')].sort(),key=`${record.group}:${keys.join('|')}`;
      if(keys[0]===keys[1])continue;
      if(edges.has(key))this.parent[this.root(index)]=this.root(edges.get(key));else edges.set(key,index);
    }
  }
  root(index) {while(this.parent[index]!==index){this.parent[index]=this.parent[this.parent[index]];index=this.parent[index];}return index;}
  connected(index) {const root=this.root(index);return this.records.flatMap((_,i)=>this.root(i)===root?[i]:[]);}
  group(index) {return this.records.flatMap((r,i)=>r.group===this.records[index].group?[i]:[]);}
  pick(selected,index,{unit='surface',extend=false,toggle=false}={}) {
    const chosen=unit==='group'?this.group(index):unit==='surface'?this.connected(index):[index];
    const next=new Set(extend||toggle?selected:[]),remove=toggle&&chosen.every(i=>next.has(i));
    for(const i of chosen)if(remove)next.delete(i);else next.add(i);
    return [...next].sort((a,b)=>a-b);
  }
}
