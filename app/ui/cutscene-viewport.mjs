import {sampleScriptProp,scriptedPartVisible} from '../../core/cutscene-script.mjs';
import * as THREE from 'three';
import {cutsceneVisibility,mapPartVisible} from '../../core/cutscene-visibility.mjs';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createModelObject} from './model-object.mjs';
import {AnimationPlayer} from './animation-player.mjs';
import {MapNavigation} from './map-navigation.mjs';
import {sceneSample,scenePosition,cutsceneCamera} from '../../core/cutscene-camera.mjs';
import {samplePropMatrix} from '../../core/cutscene-props.mjs';

/** One renderer and one transport clock own the entire scene. */
export class CutsceneViewport {
  constructor(host,onTick,onError) {
    this.host=host;this.onTick=onTick;this.onError=onError;this.assets=[];this.players=[];this.props=[];this.lights=[];this.generation=0;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x141517);
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(45,1,1,100000);this.free=new THREE.PerspectiveCamera(45,1,1,100000);
    this.orbit=new OrbitControls(this.free,this.renderer.domElement);this.orbit.enableDamping=true;
    this.navigation=new MapNavigation(this.renderer.domElement,this.free,this.orbit);this.navigation.speed=1500;
    this.scene.add(new THREE.HemisphereLight(0xe5dfd4,0x52525a,1.7));const key=new THREE.DirectionalLight(0xffeee2,1.8);key.position.set(1,2,3);this.scene.add(key);
    this.audio=new Audio();this.audio.preload='auto';this.audio.onended=()=>{this.anchorFrame=this.frame;this.anchorTime=performance.now();};
    this.audio.onerror=()=>{if(!this.data||!this.audio.hasAttribute('src'))return;this.pause();onError('The scene soundtrack could not be played. Select another track or mute the scene.');};
    this.audio.onloadedmetadata=()=>{this.audio.currentTime=Math.min(this.audio.duration,(this.frame/30+(this.data?.audioOffset||0)));};
    this.frame=0;this.playing=false;this.visible=true;this.mode='scene';this.letterbox=true;this.loop=false;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
    this.last=performance.now();this.renderer.setAnimationLoop(()=>this.tick());this.setMode('scene');
  }
  async load(data) {
    this.clear();const generation=this.generation;this.data=data;this.mapVisibility=cutsceneVisibility(data);this.visibilityEnabled=true;this.mapParts=[];this.scriptHidden=[];
    try {
      for(const source of [...data.environment,...data.actors]) {
        const asset=await createModelObject(source.model,source.textures);
        if(this.generation!==generation){asset.dispose();return false;}
        this.assets.push(asset);this.scene.add(asset.group);
        if(source.clip){const player=new AnimationPlayer(asset);player.clip('skeletal',source.clip);player.loop=false;player.playing=false;this.players.push(player);source.model.meshes.forEach((part,i)=>{if(!scriptedPartVisible(data.sceneId,source.modelId,part))this.scriptHidden.push(asset.meshes[i]);});}
        else source.model.meshes.forEach((part,i)=>{
          if(part.objectType===2)this.mapParts.push({part,mesh:asset.meshes[i]});
          const target=data.propTargets.find(target=>target.key===source.key&&target.identity===part.partId);
          const scripted=data.proceduralProps?.find(t=>t.key===source.key&&t.identity===part.partId&&part.objectType===3);
          const track=scripted||(target&&part.objectType===3?data.props.find(t=>part.partId===(t.modelId*65536+t.index)):null);
          if(track){const mesh=asset.meshes[i];mesh.matrixAutoUpdate=false;this.props.push({mesh,track,scripted:!!scripted,inverse:new THREE.Matrix4().fromArray(part.layout.matrix).invert()});}
        });
      }
      for(const track of data.lights) {
        const light=track.type===5?new THREE.DirectionalLight():track.type===7?new THREE.SpotLight():new THREE.PointLight();
        light.intensity=1;light.decay=0;this.scene.add(light);if(light.target)this.scene.add(light.target);this.lights.push({track,light});
      }
      if(data.audio){this.audio.src=data.audio;this.audio.load();}
      this.seek(0);this.free.copy(this.camera);this.orbit.target.fromArray(cutsceneCamera(sceneSample(data.camera,0,data.cuts)).target);this.resize();return true;
    }catch(error){if(this.generation===generation)this.clear();throw error;}
  }
  setMode(mode){this.mode=mode;this.navigation.reset();this.navigation.enabled=mode==='free';this.orbit.enabled=mode==='free';if(mode==='free'&&this.data){this.free.copy(this.camera);this.orbit.target.fromArray(cutsceneCamera(sceneSample(this.data.camera,this.frame,this.data.cuts)).target);}this.resize();}
  resize(){const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height)return;this.renderer.setSize(width,height);this.free.aspect=width/height;this.free.updateProjectionMatrix();}
  seek(frame){this.frame=Math.max(0,Math.min((this.data?.frameCount||1)-1,frame));this.anchorFrame=this.frame;this.anchorTime=performance.now();if(this.audio.readyState)this.audio.currentTime=Math.min(this.audio.duration,(this.frame/30+(this.data?.audioOffset||0)));if(this.playing&&this.audio.src&&this.audio.paused&&(this.frame/30+(this.data?.audioOffset||0))<this.audio.duration)this.audio.play().catch(error=>{this.pause();this.onError(error.message);});this.apply();this.onTick(this);}
  async play(){if(!this.data)return;if(this.frame>=this.data.frameCount-1)this.seek(0);this.anchorFrame=this.frame;this.anchorTime=performance.now();this.playing=true;
    if(this.audio.src&&(this.frame/30+(this.data?.audioOffset||0))<(this.audio.duration||Infinity))try{await this.audio.play();}catch(error){this.pause();this.onError('Audio playback failed: '+error.message);}this.onTick(this);}
  pause(){this.playing=false;this.audio.pause();this.onTick(this);}
  setVisible(visible){this.visible=visible;if(!visible){this.pause();this.navigation.reset();}else this.resize();}
  apply(){if(!this.data)return;
    if(this.mapVisibility.available)for(const {part,mesh} of this.mapParts)mesh.visible=!this.visibilityEnabled||mapPartVisible(part,this.mapVisibility.at(this.frame));
    for(const player of this.players)player.seek(this.frame);
    for(const mesh of this.scriptHidden)mesh.visible=false;
    for(const {mesh,track,inverse,scripted} of this.props){(scripted?sampleScriptProp(track,this.frame,mesh.matrix):samplePropMatrix(track,this.frame,this.data.cuts,mesh.matrix)).multiply(inverse);mesh.matrixWorldNeedsUpdate=true;}
    const camera=cutsceneCamera(sceneSample(this.data.camera,this.frame,this.data.cuts));
    this.camera.position.fromArray(camera.eye);this.camera.up.set(0,1,0);this.camera.lookAt(new THREE.Vector3(...camera.target));this.camera.rotateZ(camera.roll);this.camera.fov=camera.fov;
    for(const {track,light} of this.lights){const v=sceneSample(track,this.frame,this.data.cuts);light.color.setRGB(v[3],v[4],v[5]);
      if(track.type===5){light.position.set(0,0,0);light.target.position.set(v[6],-v[7],v[8]);}
      else{light.position.fromArray(scenePosition(v));light.distance=Math.max(0,v[7]*50);if(track.type===7){light.target.position.fromArray(scenePosition(v.slice(8,11)));light.angle=Math.min(Math.PI/2,Math.max(.001,(v[11]+v[12])*Math.PI/360));light.penumbra=Math.max(0,Math.min(1,v[12]/Math.max(.001,v[11]+v[12])));}}
    }
  }
  tick(){const now=performance.now(),dt=Math.min(.1,(now-this.last)/1000);this.last=now;if(!this.visible||!this.data)return;
    if(this.playing){this.frame=this.audio.src&&!this.audio.paused&&!this.audio.ended?Math.max(0,(this.audio.currentTime-(this.data.audioOffset||0))*30):this.anchorFrame+(now-this.anchorTime)*.03;
      if(this.frame>=this.data.frameCount){if(this.loop){this.seek(0);this.play();}else{this.pause();this.seek(this.data.frameCount-1);}}
      this.apply();this.onTick(this);}
    this.navigation.update(dt);if(this.mode==='free')this.orbit.update();
    const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height)return;
    let w=width,h=height;if(this.mode==='scene'&&this.letterbox){w=Math.min(width,height*4/3);h=w*3/4;}
    this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,width,height);this.renderer.clear();this.renderer.setViewport((width-w)/2,(height-h)/2,w,h);this.renderer.setScissor((width-w)/2,(height-h)/2,w,h);this.renderer.setScissorTest(true);
    const camera=this.mode==='scene'?this.camera:this.free;camera.aspect=w/h;camera.updateProjectionMatrix();this.renderer.render(this.scene,camera);this.renderer.setScissorTest(false);
  }
  clear(){++this.generation;this.pause();this.audio.removeAttribute('src');this.audio.load();this.assets.forEach(a=>a.dispose());this.assets=[];this.players=[];this.props=[];this.lights.forEach(({light})=>{light.target?.removeFromParent();light.removeFromParent();light.dispose?.();});this.lights=[];this.data=null;this.mapParts=[];this.mapVisibility=null;this.frame=0;this.renderer.clear();}
  dispose(){this.clear();this.renderer.setAnimationLoop(null);this.resizeObserver.disconnect();this.navigation.dispose();this.orbit.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
