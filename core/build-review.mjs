import {sha256} from './binary.mjs';
import {modelTemplate} from './model-provenance.mjs';
import {parseModel} from './model.mjs';
import {modelDiagnostics} from './model-review.mjs';

export function buildFingerprint(workbench) {
  return sha256(Buffer.from(JSON.stringify([...workbench.changes].map(([key,c])=>[key,sha256(c.data)]))));
}

/** Use the build validator itself; a failed check remains a blocking issue. */
export function buildReview(workbench) {
  const issues=[],assets=[],patches=[];
  for(const [key,change] of workbench.changes){
    const {entry,archive}=workbench.get(key);
    const asset={key,name:entry.name,archive:archive.name||archive.file.split(/[\\/]/).pop(),size:change.data.length,originalSize:entry.size,extension:entry.extension,label:change.label};assets.push(asset);
    try {
      workbench.prepareChange(key,change.data,change.label);
      if(/^mdl_?$/.test(entry.extension)){
        const diagnostics=modelDiagnostics(parseModel(change.data),parseModel(modelTemplate(workbench.originalBytes(archive,entry))));
        for(const issue of diagnostics.issues)issues.push({...issue,key});
        issues.push({key,severity:'info',message:'Check gameplay, equipment and cutscene visibility in the game; the preview cannot reproduce every runtime rule.'});
      }
      for(const warning of change.animationReport?.skippedChannels||[])issues.push({key,severity:'warning',message:typeof warning==='string'?warning:`${warning.bone} · ${warning.channel} · frames ${warning.firstFrame}–${warning.lastFrame}: ${warning.reason}`});
      if(entry.extension==='kg1')issues.push({key,severity:'warning',message:'KG1 uses rigid bone volumes. Verify RealTime Shadows on animated poses and facial morphs.'});
    }catch(error){issues.push({key,severity:'error',message:error.message});}
  }
  let requirements=null;
  try {requirements=workbench.buildRequirements();}
  catch(error){issues.push({severity:'error',message:error.message});}
  if(!assets.length)issues.push({severity:'error',message:'No replacements are staged.'});
  const definitions=[
    ['requiresMorphPatch','Pose morph buffer','morphNodes','morph nodes'],
    ['requiresPrimaryIndexPatch','32-bit primary indices','primaryVertices','primary vertices'],
    ['requiresSecondaryPatch','Transparent model geometry','secondaryVertices','transparent vertices'],
    ['requiresModelTexturePatch','Model texture tables','textureSlots','texture slots'],
    ['requiresFontPatch','High-resolution font atlas','fontScale','× atlas scale'],
    ['requiresPicturePatch','Picture loading arena','pictureBytes','picture bytes'],
    ['requiresCharacterPatch','Character loading arena',null,'Expanded character assets'],
    ['requiresBackgroundPatch','Map loading arena',null,'Expanded stage resources'],
    ['requiresMapGeometryPatch','Transparent map sorting',null,'Additional transparent map triangles'],
  ];
  if(requirements)for(const [flag,name,metric,unit] of definitions)if(requirements[flag]){
    const relevant=asset=>flag==='requiresFontPatch'?asset.extension==='bin':flag==='requiresPicturePatch'?asset.extension==='tex':flag==='requiresMapGeometryPatch'?asset.extension==='map':flag==='requiresBackgroundPatch'?/^(map|cld|cam|tex|ded|kg2)$/.test(asset.extension):flag==='requiresCharacterPatch'?/^(mdl_?|anm_?|kg1)$/.test(asset.extension):/^mdl_?$/.test(asset.extension);
    patches.push({name,reason:metric?`${requirements[metric].toLocaleString('en-US')} ${unit}`:unit,assets:assets.filter(relevant).map(asset=>({key:asset.key,name:asset.name}))});
  }
  return {token:buildFingerprint(workbench),assets,issues,patches,requirements,canBuild:!issues.some(issue=>issue.severity==='error')};
}
