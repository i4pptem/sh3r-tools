export function textureFixture() {
  const data=Buffer.alloc(144);data.writeUInt32LE(0xffffffff);data.writeUInt32LE(32,8);data.writeUInt32LE(data.length,12);data.writeUInt32LE(1,20);
  data.writeUInt32LE(0xffffffff,32);data.writeUInt16LE(2,40);data.writeUInt16LE(2,42);data.writeUInt32LE(16,48);data.writeUInt32LE(112,52);data.writeUInt16LE(0x9999,62);data.fill(255,128);return data;
}
export function mapFixture({tail=0,family=3}={}) {
  const partLength=208+tail,groupLength=144+partLength*2,suffix=304+groupLength,texture=Math.ceil((suffix+256)/128)*128,data=Buffer.alloc(texture+144);
  const u=(at,values)=>values.forEach((v,i)=>data.writeUInt32LE(v>>>0,at+i*4)),f=(at,values)=>values.forEach((v,i)=>data.writeFloatLE(v,at+i*4));
  u(0,[-1,0,0,80,texture,0,80,family===1?304:0,family===2?304:0,family===3?304:0]);u(48,[texture,suffix,suffix+32]);data.writeUInt16LE(1,64);data.writeUInt16LE(1,family===1?66:family===2?70:68);
  u(80,[0,32,224,0,1,0]);f(112,[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1]);
  for(let i=0;i<8;i++) f(176+i*16,[i&1?100:0,i&2?100:0,i&4?100:0,1]);
  u(304,[0,48,groupLength,0,family,0,1]);u(352,[0,48,groupLength-48]);u(400,[0,48,groupLength-96]);
  for(let m=0;m<2;m++) {
    const at=448+m*partLength;u(at,[m?0:at+partLength,64,partLength,0,4,1,m]);
    for(const [i,p] of [[0,[0,0,0]],[1,[4,0,0]],[2,[0,4,0]],[3,[0,4,0]]]) {f(at+64+i*36,p);f(at+76+i*36,[0,0,1]);f(at+88+i*36,[p[0]/4,p[1]/4]);data.set([50,100,150,0],at+96+i*36);}
    if(tail) data.fill(0xab,at+208,at+partLength);
  }
  u(suffix+32,[suffix+64]);data.writeUInt16LE(1,suffix+64+64);data.writeUInt16LE(1,suffix+64+66);u(suffix+64+80,[suffix+176,suffix+192,0]);
  data.fill(0x31,suffix+176,suffix+192);data.fill(0x42,suffix+192,suffix+240);textureFixture().copy(data,texture);
  return data;
}

export function subdividedPart(source) {
  const result={...source,positions:[],normals:[],uv:[],colors:[],indices:[]}, triangle=source.indices.slice(0,3);
  const samples=[[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[0,.5,.5],[.5,0,.5]];
  for(const [key,size] of [['positions',3],['normals',3],['uv',2],['colors',3]]) for(const weights of samples) for(let k=0;k<size;k++) result[key].push(weights.reduce((s,w,i)=>s+w*source[key][triangle[i]*size+k],0));
  result.indices=[0,3,5,3,1,4,5,4,2,3,4,5];result.vertexCount=6;result.triangleCount=4;return result;
}
