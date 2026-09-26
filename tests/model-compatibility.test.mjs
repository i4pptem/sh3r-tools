import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCompatibility} from '../core/model-compatibility.mjs';
const info={inputs:[{index:0,name:'New hand',bones:[0,1,2]}],templates:[{name:'Gameplay',visibility:12},{name:'Detailed',visibility:3}],boneVariants:[[0],[3],[3,12]]};
test('gameplay templates report detailed-only influences while common bones remain valid',()=>{
  assert.deepEqual(modelCompatibility(info,[{input:0,template:0}])[0].bones,[1]);
  assert.deepEqual(modelCompatibility(info,[{input:0,template:1}]),[]);
});
