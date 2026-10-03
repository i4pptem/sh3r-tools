/** Diagnostics describe serialized game data, rather than the unconverted input. */
export function modelDiagnostics(model,reference=null) {
  const variants=new Map();for(const mesh of reference?.meshes||[])for(let i=0;i<(mesh.joints?.length||0);i++)if(mesh.weights[i]>0){if(!variants.has(mesh.joints[i]))variants.set(mesh.joints[i],new Set());variants.get(mesh.joints[i]).add(mesh.visibilityId);}
  const issues=[],meshes=model.meshes.map(mesh=>{
    const invalid=[],suspicious=[],variantRisk=[],usedBones=new Set();let maxInfluences=0;
    for(let vertex=0;vertex<mesh.vertexCount;vertex++){
      const weights=mesh.weights?.slice(vertex*4,vertex*4+4)||[],joints=mesh.joints?.slice(vertex*4,vertex*4+4)||[];
      const active=weights.map((weight,i)=>({weight,bone:joints[i]})).filter(item=>item.weight>0);
      active.forEach(item=>usedBones.add(item.bone));maxInfluences=Math.max(maxInfluences,active.length);
      if(model.bones.length&&(!active.length||weights.some(w=>!Number.isFinite(w)||w<0)||active.some(item=>!Number.isInteger(item.bone)||item.bone>=model.bones.length)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>.01))invalid.push(vertex);
      if(active.length>3)suspicious.push(vertex);
      if(active.some(item=>{const ids=variants.get(item.bone);return ids?.size&&!ids.has(0)&&!ids.has(mesh.visibilityId);}))variantRisk.push(vertex);
    }
    if(invalid.length)issues.push({severity:'error',message:`${mesh.name}: ${invalid.length} vertices have invalid bone indices or unnormalized weights.`});
    if(suspicious.length)issues.push({severity:'warning',message:`${mesh.name}: ${suspicious.length} vertices exceed three bone influences.`});
    if(variantRisk.length)issues.push({severity:'warning',message:`${mesh.name}: ${variantRisk.length} vertices use bones associated with other original visibility variants. Verify equipment and cutscene skinning in the game.`});
    if(mesh.texture<0||mesh.texture>=model.textureCount)issues.push({severity:'error',message:`${mesh.name}: texture slot ${mesh.texture} is missing.`});
    return {name:mesh.name,vertices:mesh.vertexCount,triangles:mesh.triangleCount,texture:mesh.texture,visibility:mesh.visibilityId,bones:[...usedBones],maxInfluences,invalid,suspicious,variantRisk};
  });
  return {meshes,issues,vertices:meshes.reduce((n,m)=>n+m.vertices,0),triangles:meshes.reduce((n,m)=>n+m.triangles,0),textures:model.textureCount,bones:model.bones.length,morphs:model.morphNames.length};
}
