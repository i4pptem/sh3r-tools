import {BACKGROUND_LIMITS} from './background-runtime.mjs';
import {requireThat} from './binary.mjs';
import {stageBackgroundBudget} from './background-budget.mjs';

const normalize=name=>name.replaceAll('\\','/').toLowerCase();
const stages=new Set('mr mu tr us bc br bu tg am cm ot cc th hp hc hu tp cr cu cz'.split(' '));
function stageFor(name) {
  const match=/^data\/(?:tmp\/([a-z]{2})(?:[0-9a-f]{2}(?:tr)?|gb)?\.(?:map|tex)|bg\/([a-z]{2})\/[^/]+\.(?:cld|cam|ded|uni|kg2|lgt|lv))$/.exec(normalize(name));
  const stage=match?.[1]||match?.[2];return stages.has(stage)?stage:null;
}
const mib=bytes=>(bytes/1048576).toFixed(2)+' MiB';

/** Enforce native room and transition storage budgets against every staged companion. */
export function validateBackgroundMemory(workbench,updates) {
  const affected=new Set();
  for(const update of updates){const {entry}=workbench.get(update.key),stage=stageFor(entry.name);if(stage&&update.data.length>entry.size)affected.add(stage);}
  if(!affected.size)return [];
  requireThat(workbench.dataRoot&&workbench.catalogPath,'Open the complete game data folder before enlarging MAP or its companion files. Memory validation needs every room in the stage.');
  const entries=workbench.snapshot().entries,pending=new Map(updates.map(update=>[update.key,update.data.length]));
  const byName=new Map(entries.map(entry=>[normalize(entry.name),entry]));
  const size=name=>{const entry=byName.get(normalize(name));return entry?pending.get(entry.key)??workbench.changes.get(entry.key)?.data.length??entry.size:undefined;};
  const reports=[];
  for(const stage of affected){
    const maps=entries.filter(entry=>new RegExp(`^data/tmp/${stage}[0-9a-f]{2}\\.map$`).test(normalize(entry.name))).map(entry=>entry.name);
    requireThat(maps.length,`Cannot validate ${stage.toUpperCase()} world memory: no room maps in the catalog.`);
    const stock=stageBackgroundBudget(maps,size),requiresBackgroundPatch=!stock.conservativeTransitionFits;
    const report=requiresBackgroundPatch?stageBackgroundBudget(maps,size,{primaryBytes:BACKGROUND_LIMITS.arenaBytes}):stock;
    reports.push({...report,requiresBackgroundPatch});
    requireThat(report.conservativeTransitionFits,`${stage.toUpperCase()} room memory exceeded: two largest rooms need ${mib(report.conservativeTransitionBytes)}, available ${mib(report.partitionBytes)} after shared resources. Reduce texture resolution or geometry (${mib(-report.conservativeTransitionRemainingBytes)} over budget). The expanded 256 MiB MAP arena is also full.`);
  }
  return reports;
}
