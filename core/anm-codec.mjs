/** Native PC ANM scalar and quaternion codecs. Unchanged channels retain source bytes. */
const even = value => {
  const lower=Math.floor(value),fraction=value-lower;
  return fraction>0.5||(fraction===0.5&&lower%2!==0)?lower+1:lower;
};
export function decodeNativeShort(word) {
  if(!Number.isInteger(word)||word<0||word>65535)throw new RangeError('Expected u16');
  return (word&0x8000?-1:1)*(1+(word&1023)/1024)*2**(((word>>>10)&31)-15);
}
export function encodeNativeShort(value) {
  if(!Number.isFinite(value)||Math.abs(value)>131008)throw new RangeError('Native short-float range exceeded');
  const sign=value<0||Object.is(value,-0)?0x8000:0,magnitude=Math.abs(value);
  if(magnitude<=2**-15)return sign;
  let exponent=Math.max(-15,Math.min(16,Math.floor(Math.log2(magnitude))));
  let significand=even(magnitude/2**exponent*1024);
  if(significand===2048){exponent++;significand=1024;}
  if(exponent>16)throw new RangeError('Native short-float rounding overflow');
  return sign|((exponent+15)<<10)|(significand-1024);
}
export function decodePackedQuaternion(xyz,flag) {
  if(xyz.length!==3||xyz.some(v=>!Number.isInteger(v)||v<-32768||v>32767))throw new RangeError('Expected three i16 values');
  const q=xyz.map(v=>v/32768),squared=q.reduce((n,v)=>n+v*v,0);
  q.push(Math.fround(Math.sqrt(Math.max(0,1-squared)))*(flag&4?-1:1));
  return q;
}
export function encodePackedQuaternion(input,sourceFlag) {
  if(input.length!==4||input.some(v=>!Number.isFinite(v))||![1,2,5,6].includes(sourceFlag&7))throw new RangeError('Invalid quaternion or ANM channel');
  const length=Math.hypot(...input);if(!length)throw new RangeError('Zero quaternion');
  const unit=input.map(v=>v/length);let best=null;
  for(const hemisphere of [1,-1]){
    const value=unit.map(v=>v*hemisphere),xyz=value.slice(0,3).map(v=>Math.max(-32768,Math.min(32767,even(v*32768))));
    const negative=value[3]<0||Object.is(value[3],-0),flag=(sourceFlag&~4)|(negative?4:0),decoded=decodePackedQuaternion(xyz,flag);
    const norm=Math.hypot(...decoded),dot=Math.min(1,Math.abs(unit.reduce((n,v,i)=>n+v*decoded[i]/norm,0))),error=1-dot;
    const candidate={xyz,flag,decoded,error,angularError:2*Math.acos(dot)};
    if(!best||error<best.error||(error===best.error&&Boolean(flag&4)===Boolean(sourceFlag&4)))best=candidate;
  }
  return best;
}
