import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {requireThat,MAX_ASSET} from './binary.mjs';

export function findBlender() {
  if(process.env.SH3TOOLS_BLENDER && fs.existsSync(process.env.SH3TOOLS_BLENDER))return process.env.SH3TOOLS_BLENDER;
  const root=path.join(process.env.ProgramFiles || 'C:/Program Files','Blender Foundation');
  if(!fs.existsSync(root))return null;
  const candidates=fs.readdirSync(root).filter(name=>/^Blender [\d.]+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  return candidates.map(name=>path.join(root,name,'blender.exe')).find(file=>fs.existsSync(file)) || null;
}

/** Run the installed Blender without auto-executing blend scripts or changing the input file. */
export async function blenderExchange(job, glb, cacheFolder, progress=()=>{}, files={}, destination=null) {
  const executable=findBlender();requireThat(executable,'Install Blender 4.2 or newer, or set SH3TOOLS_BLENDER to blender.exe. This exchange workflow uses Blender.');
  requireThat(['morph_workspace','animation_exchange','model_export','model_import','scene_export','scene_import'].includes(job.script),'Invalid Blender exchange script.');
  fs.mkdirSync(cacheFolder,{recursive:true});const folder=fs.mkdtempSync(path.join(cacheFolder,'blender-'));
  try {
    for(const [name,bytes] of Object.entries(files)){requireThat(/^[a-z0-9-]+\.(glb|wav)$/.test(name),'Invalid Blender attachment name.');fs.writeFileSync(path.join(folder,name),bytes);}
    const request={...job,folder};if(glb)fs.writeFileSync(path.join(folder,'model.glb'),glb);
    const jobFile=path.join(folder,'job.json');fs.writeFileSync(jobFile,JSON.stringify(request));
    const script=fileURLToPath(new URL(`../tools/blender/${job.script}.py`,import.meta.url));
    progress({message:'Starting Blender',detail:'Preparing the background export process.'});
    let log='';const code=await new Promise((resolve,reject)=>{
      const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python',script,'--',jobFile],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
      for(const stream of [child.stdout,child.stderr])createInterface({input:stream,crlfDelay:Infinity}).on('line',line=>{
        log=(log+line+'\n').slice(-16000);
        if(line.startsWith('SH3_PROGRESS_JSON ')){
          try{const value=JSON.parse(line.slice(18));requireThat(typeof value.message==='string','Invalid Blender progress message.');progress(value);}
          catch(error){child.kill();reject(error);}
        } else if(line.startsWith('SH3_PROGRESS '))progress({message:line.slice(13)});
      });
      child.on('error',reject);child.on('close',resolve);
    });
    const reportFile=path.join(folder,'report.json'),report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):null;
    requireThat(code===0 && report && !report.error,report?.error || `Blender exchange failed (${code}): ${log.slice(-3000)}`);
    const output=path.join(folder,'result.'+job.outputType);
    progress({message:'Writing exported result',detail:'Blender processing has completed.'});
    if(destination){
      requireThat(job.script==='scene_export'&&job.outputType==='blend','Direct file output is reserved for complete Blender scenes.');
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.copyFileSync(output,destination,fs.constants.COPYFILE_EXCL);
      return {file:destination,report};
    }
    requireThat(fs.statSync(output).size<=MAX_ASSET,'Blender result exceeds the 256 MiB asset limit.');
    return {data:fs.readFileSync(output),report};
  } finally {
    const target=path.resolve(folder),root=path.resolve(cacheFolder);requireThat(target.startsWith(root+path.sep) && path.basename(target).startsWith('blender-'),'Unsafe Blender temporary path.');
    fs.rmSync(target,{recursive:true,force:true});
  }
}
