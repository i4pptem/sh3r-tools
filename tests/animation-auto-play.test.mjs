import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationPlayer} from '../app/ui/animation-player.mjs';

test('auto-play restarts one-shot ANM actions without changing their native loop or skipping the last frame',()=>{
 const player=new AnimationPlayer({meshes:[]});player.skeletal={sourceFormat:'anm',frameCount:100};player.start=17;player.end=26;player.frame=26.5;player.fps=30;player.loop=false;player.autoReplay=true;player.playing=true;player.apply=()=>{};
 player.update(.25/30);assert.equal(player.frame,26.75);assert.equal(player.playing,true);
 player.update(.5/30);assert.equal(player.frame,17.25);assert.equal(player.loop,false);assert.equal(player.playing,true);
 player.stop();player.update(1);assert.equal(player.frame,17);assert.equal(player.playing,false);
});
test('disabled auto-play and PACK playback retain the original stop behavior',()=>{
 for(const [sourceFormat,autoReplay] of [['anm',false],['pack',true]]) {
  const player=new AnimationPlayer({meshes:[]});player.skeletal={sourceFormat,frameCount:2};player.start=0;player.end=1;player.frame=1;player.fps=30;player.loop=false;player.autoReplay=autoReplay;player.playing=true;player.apply=()=>{};player.update(1/30);assert.equal(player.frame,1);assert.equal(player.playing,false);
 }
});
