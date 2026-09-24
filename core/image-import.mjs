/** Resample straight RGBA through premultiplied alpha to avoid dark transparent edges. */
export function resizeImage(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.max(0, Math.min(image.width - 1, (x + .5) * image.width / width - .5)), sy = Math.max(0, Math.min(image.height - 1, (y + .5) * image.height / height - .5));
    const left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
    const samples = [[left, top, (1-fx)*(1-fy)], [Math.min(left+1,image.width-1), top, fx*(1-fy)], [left, Math.min(top+1,image.height-1), (1-fx)*fy], [Math.min(left+1,image.width-1), Math.min(top+1,image.height-1), fx*fy]];
    const color = [0,0,0,0];
    for (const [px,py,weight] of samples) {const p=(py*image.width+px)*4, alpha=image.data[p+3]*weight; color[3]+=alpha; for(let c=0;c<3;c++)color[c]+=image.data[p+c]*alpha;}
    const dest=(y*width+x)*4; for(let c=0;c<3;c++)data[dest+c]=color[3] ? Math.round(color[c]/color[3]) : 0; data[dest+3]=Math.round(color[3]);
  }
  return {width, height, data};
}

/** Weighted median-cut palette with deterministic nearest-color assignment; no forced dithering. */
export function indexedImage(image, limit) {
  const histogram = new Map();
  for(let p=0;p<image.data.length;p+=4) {
    const color=[image.data[p],image.data[p+1],image.data[p+2],Math.round(image.data[p+3]/2)], key=color.join(',');
    const found=histogram.get(key); if(found)found.count++; else histogram.set(key,{color,count:1});
  }
  const makeBox=colors=>{const min=[255,255,255,128],max=[0,0,0,0]; let weight=0;
    for(const item of colors){weight+=item.count;for(let c=0;c<4;c++){min[c]=Math.min(min[c],item.color[c]);max[c]=Math.max(max[c],item.color[c]);}}
    const spans=max.map((value,c)=>(value-min[c])*(c===3?2:1)), axis=spans.indexOf(Math.max(...spans));
    return {colors,weight,axis,score:Math.max(...spans)*Math.sqrt(weight)};
  };
  const colors=[...histogram.values()]; let palette;
  if(colors.length<=limit) palette=colors.map(item=>item.color);
  else {
    const boxes=[makeBox(colors)];
    while(boxes.length<limit) {
      boxes.sort((a,b)=>b.score-a.score); const box=boxes.shift();
      if(box.colors.length===1){boxes.unshift(box);break;}
      box.colors.sort((a,b)=>a.color[box.axis]-b.color[box.axis]); let sum=0,split=0;
      while(split<box.colors.length-1&&sum<box.weight/2)sum+=box.colors[split++].count;
      boxes.push(makeBox(box.colors.slice(0,split)),makeBox(box.colors.slice(split)));
    }
    palette=boxes.map(box=>[0,1,2,3].map(c=>Math.round(box.colors.reduce((sum,item)=>sum+item.color[c]*item.count,0)/box.weight)));
  }
  for(const item of colors) {let best=Infinity,index=0;
    palette.forEach((color,i)=>{const distance=color.reduce((sum,value,c)=>sum+((value-item.color[c])*(c===3?2:1))**2,0); if(distance<best){best=distance;index=i;}});
    item.index=index;
  }
  const data=Buffer.alloc(image.data.length);
  for(let p=0;p<data.length;p+=4){const key=[image.data[p],image.data[p+1],image.data[p+2],Math.round(image.data[p+3]/2)].join(','),color=palette[histogram.get(key).index];
    for(let c=0;c<3;c++)data[p+c]=color[c];data[p+3]=Math.min(255,color[3]*2);
  }
  return {...image,data};
}
