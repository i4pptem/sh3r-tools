import test from 'node:test';import assert from 'node:assert/strict';
import {cutsceneVisibility,mapPartVisible} from '../core/cutscene-visibility.mjs';
test('native scene masks reset each update and arbitrary seeks do not retain past visibility',()=>{
 const data={frameCount:4,cuts:[0,1,0],masks:[{modelId:0,frameCount:4,stride:1,values:[1,2,0,8]},{modelId:0,frameCount:2,stride:1,values:[0,4]},{modelId:1,frameCount:1,stride:1,values:[16]}]},visibility=cutsceneVisibility(data);
 assert.equal(visibility.at(3),12);assert.equal(visibility.at(0),1);assert.equal(visibility.at(2),4);assert.equal(visibility.at(1.5),4);assert.equal(visibility.available,true);
 assert.equal(mapPartVisible({objectType:2,partId:35},visibility.at(0)),false);assert.equal(mapPartVisible({objectType:2,partId:35},visibility.at(3)),true);
 assert.equal(mapPartVisible({objectType:1,partId:35},0),true);assert.equal(mapPartVisible({objectType:3,partId:35},0),true);
});
test('cut masks obey the native fractional threshold and preserve unsigned bit31',()=>{
 const visibility=cutsceneVisibility({frameCount:2,cuts:[1],masks:[{modelId:0,frameCount:2,stride:1,values:[0,0x80000000]}]});
 assert.equal(visibility.at(.01),0);assert.equal(visibility.at(.011),0x80000000);assert.equal(mapPartVisible({objectType:2,partId:31},visibility.at(1)),true);
 assert.equal(cutsceneVisibility({frameCount:2,masks:[]}).available,false);
});
