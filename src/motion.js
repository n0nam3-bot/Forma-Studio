import * as THREE from 'three';
import { BONE_GROUPS, applyBonePose, JOINT_LIMITS } from './model.js';

const deg = THREE.MathUtils.degToRad;
const smooth = (a,b,x) => { const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const pulse = (t,phase=0) => Math.sin((t+phase)*Math.PI*2);
const blank = () => ({});
const set = (pose,name,x=0,y=0,z=0) => { pose[name]=[deg(x),deg(y),deg(z)]; };

export const MOTIONS = [
  {name:'Idle',duration:3,loop:true,category:'full',description:'Breathing idle'},
  {name:'Walk',duration:1.15,loop:true,category:'full',description:'Walk cycle'},
  {name:'Run',duration:.78,loop:true,category:'full',description:'Run cycle'},
  {name:'Crouch',duration:2,loop:true,category:'full',description:'Low ready crouch'},
  {name:'Jump',duration:1.15,loop:false,category:'full',description:'Jump take-off and landing'},
  {name:'Wave',duration:1.55,loop:true,category:'gesture',description:'Right-hand wave'},
  {name:'Punch',duration:.78,loop:false,category:'upper',description:'Right straight punch'},
  {name:'Kick',duration:.92,loop:false,category:'lower',description:'Right front kick'},
  {name:'Sword Slash',duration:1.05,loop:false,category:'upper',description:'Two-hand diagonal slash'},
  {name:'Hit React',duration:.8,loop:false,category:'upper',description:'Upper-body impact reaction'},
  {name:'Roll',duration:1.35,loop:false,category:'full',description:'Forward roll shape'},
  {name:'Nod',duration:1.2,loop:true,category:'gesture',description:'Head nod'},
];

function poseFor(name, t) {
  const p=blank();
  const s=pulse(t);
  const c=Math.cos(t*Math.PI*2);
  switch(name) {
    case 'Idle':
      set(p,'Chest',1.8*s,0,.6*s);
      set(p,'SpineMid',.7*s,0,0);
      set(p,'Head',-.6*s,0,0);
      set(p,'UpperArm_L',0,0,-3);
      set(p,'UpperArm_R',0,0,3);
      break;
    case 'Walk': {
      const legL=24*s, legR=-24*s;
      set(p,'UpperLeg_L',legL,0,0); set(p,'UpperLeg_R',legR,0,0);
      set(p,'LowerLeg_L',Math.max(0,-s)*38,0,0); set(p,'LowerLeg_R',Math.max(0,s)*38,0,0);
      set(p,'Foot_L',-Math.max(0,s)*17,0,0); set(p,'Foot_R',-Math.max(0,-s)*17,0,0);
      set(p,'UpperArm_L',0,-legL*.75,-2); set(p,'UpperArm_R',0,-legR*.75,2);
      set(p,'LowerArm_L',0,0,-18); set(p,'LowerArm_R',0,0,18);
      set(p,'Hips',0,0,1.5*s); set(p,'Chest',0,0,-1.5*s);
      break;
    }
    case 'Run': {
      const swing=38*s;
      set(p,'UpperLeg_L',swing,0,0); set(p,'UpperLeg_R',-swing,0,0);
      set(p,'LowerLeg_L',Math.max(0,-s)*74,0,0); set(p,'LowerLeg_R',Math.max(0,s)*74,0,0);
      set(p,'Foot_L',-Math.max(0,s)*25,0,0); set(p,'Foot_R',-Math.max(0,-s)*25,0,0);
      set(p,'UpperArm_L',0,-swing*.82,-7); set(p,'UpperArm_R',0,swing*.82,7);
      set(p,'LowerArm_L',0,0,-72); set(p,'LowerArm_R',0,0,72);
      set(p,'Spine',12,0,0); set(p,'Chest',-5,0,0);
      break;
    }
    case 'Crouch':
      set(p,'Hips',-8,0,0); set(p,'Spine',18,0,0); set(p,'SpineMid',8,0,0);
      set(p,'UpperLeg_L',-48,0,0); set(p,'UpperLeg_R',-48,0,0);
      set(p,'LowerLeg_L',94,0,0); set(p,'LowerLeg_R',94,0,0);
      set(p,'Foot_L',-38,0,0); set(p,'Foot_R',-38,0,0);
      set(p,'UpperArm_L',0,-12,-22); set(p,'UpperArm_R',0,-12,22);
      set(p,'LowerArm_L',0,0,-48); set(p,'LowerArm_R',0,0,48);
      break;
    case 'Jump': {
      const rise=smooth(0,.2,t), land=smooth(.75,1,t);
      const air=Math.sin(Math.PI*THREE.MathUtils.clamp((t-.16)/.68,0,1));
      const crouch=1-smooth(.05,.23,t);
      set(p,'Hips',-7*crouch+6*land,0,0);
      set(p,'Spine',-10*air,0,0);
      set(p,'UpperLeg_L',-55*crouch+14*air,0,0); set(p,'UpperLeg_R',-55*crouch+14*air,0,0);
      set(p,'LowerLeg_L',72*crouch+22*air,0,0); set(p,'LowerLeg_R',72*crouch+22*air,0,0);
      set(p,'Foot_L',-24*air,0,0); set(p,'Foot_R',-24*air,0,0);
      set(p,'UpperArm_L',0,0,-66*air); set(p,'UpperArm_R',0,0,66*air);
      set(p,'LowerArm_L',0,0,-22); set(p,'LowerArm_R',0,0,22);
      break;
    }
    case 'Wave': {
      const wave=Math.sin(t*Math.PI*4);
      set(p,'UpperArm_R',-12,0,92);
      set(p,'LowerArm_R',0,0,68);
      set(p,'Hand_R',0,wave*34,0);
      set(p,'UpperArm_L',0,0,-4);
      break;
    }
    case 'Punch': {
      const prep=1-smooth(0,.23,t), hit=smooth(.24,.45,t)*(1-smooth(.56,.87,t)), recover=smooth(.7,1,t);
      set(p,'Hips',-8*prep+12*hit,0,0); set(p,'Chest',-8*prep+16*hit,0,-4*hit);
      set(p,'UpperArm_R',0,-52*hit-20*prep,18+18*hit);
      set(p,'LowerArm_R',0,0,88*(1-hit)+10);
      set(p,'UpperArm_L',0,-18,-35); set(p,'LowerArm_L',0,0,-92);
      set(p,'Head',-5*hit,0,0);
      break;
    }
    case 'Kick': {
      const prep=1-smooth(0,.2,t), extension=smooth(.2,.43,t)*(1-smooth(.57,.82,t));
      set(p,'UpperLeg_R',-18-78*extension-18*prep,0,0);
      set(p,'LowerLeg_R',Math.max(0,1-extension)*82,0,0);
      set(p,'Foot_R',-22*extension,0,0);
      set(p,'UpperLeg_L',-18,0,0); set(p,'LowerLeg_L',18,0,0);
      set(p,'UpperArm_L',0,-10,-30); set(p,'UpperArm_R',0,-10,35);
      set(p,'LowerArm_L',0,0,-70); set(p,'LowerArm_R',0,0,70);
      set(p,'Spine',-12*extension,0,0);
      break;
    }
    case 'Sword Slash': {
      const wind=1-smooth(0,.28,t), slash=smooth(.25,.57,t)*(1-smooth(.6,.84,t));
      set(p,'UpperArm_L',-15-25*wind+35*slash,-18, -65-20*wind+50*slash);
      set(p,'LowerArm_L',0,0,-(70+10*wind-35*slash));
      set(p,'UpperArm_R',-15-25*wind+35*slash,18,65+20*wind-50*slash);
      set(p,'LowerArm_R',0,0,70+10*wind-35*slash);
      set(p,'Chest',-8*wind+18*slash,0,-35*slash);
      set(p,'Hips',-4*wind+10*slash,0,18*slash);
      set(p,'UpperLeg_L',-8,0,0); set(p,'UpperLeg_R',-14,0,0);
      break;
    }
    case 'Hit React': {
      const impact=Math.sin(Math.PI*THREE.MathUtils.clamp(t/.55,0,1))*(1-smooth(.52,1,t));
      set(p,'Chest',-25*impact,0,12*impact); set(p,'Spine',-9*impact,0,0);
      set(p,'Head',-18*impact,0,0);
      set(p,'UpperArm_L',-35*impact,0,-68*impact); set(p,'UpperArm_R',-35*impact,0,68*impact);
      set(p,'LowerArm_L',0,0,-85*impact); set(p,'LowerArm_R',0,0,85*impact);
      set(p,'Hips',8*impact,0,0);
      break;
    }
    case 'Roll': {
      const tuck=smooth(0,.22,t), tuckOut=1-smooth(.68,1,t), roll=Math.sin(t*Math.PI*2)*smooth(.12,.4,t)*(1-smooth(.7,.95,t));
      set(p,'Hips',-25*tuck*tuckOut+Math.max(0,roll)*25,0,0);
      set(p,'Spine',50*tuck*tuckOut+roll*30,0,0); set(p,'SpineMid',35*tuck*tuckOut,0,0);
      set(p,'UpperLeg_L',-65*tuck*tuckOut,0,0); set(p,'UpperLeg_R',-65*tuck*tuckOut,0,0);
      set(p,'LowerLeg_L',95*tuck*tuckOut,0,0); set(p,'LowerLeg_R',95*tuck*tuckOut,0,0);
      set(p,'UpperArm_L',-25,0,-58); set(p,'UpperArm_R',-25,0,58);
      set(p,'LowerArm_L',0,0,-75); set(p,'LowerArm_R',0,0,75);
      break;
    }
    case 'Nod':
      set(p,'Head',pulse(t)*18,0,0); set(p,'Neck',pulse(t)*5,0,0);
      break;
    case 'Head Nod':
      set(p,'Head',Math.sin(t*Math.PI*2)*18,0,0); set(p,'Neck',Math.sin(t*Math.PI*2)*5,0,0);
      break;
    case 'Guard':
      set(p,'UpperArm_L',0,-10,-54); set(p,'UpperArm_R',0,-10,54);
      set(p,'LowerArm_L',0,0,-95); set(p,'LowerArm_R',0,0,95);
      set(p,'Spine',7,0,0);
      break;
    case 'Point':
      set(p,'UpperArm_R',-5,-25,72); set(p,'LowerArm_R',8,0,0); set(p,'Hand_R',0,0,0);
      break;
    case 'Breathing':
      set(p,'Chest',2.5*Math.sin(t*Math.PI*2),0,0); set(p,'SpineMid',Math.sin(t*Math.PI*2),0,0);
      break;
  }
  return p;
}

export function getMotion(name) {
  return MOTIONS.find(m=>m.name===name) || MOTIONS[0];
}

export function getMotionPose(name, normalizedTime) {
  const motion=getMotion(name);
  const t=motion.loop ? ((normalizedTime%1)+1)%1 : THREE.MathUtils.clamp(normalizedTime,0,1);
  return poseFor(name,t);
}

export function getOverlayPose(name, normalizedTime) {
  if (!name) return {};
  const durationMap={'Head Nod':'Nod',Guard:'Guard',Point:'Point',Breathing:'Breathing'};
  const internal=durationMap[name] || name;
  return poseFor(internal,((normalizedTime%1)+1)%1);
}

export function maskBoneNames(mask) {
  switch(mask) {
    case 'rightArm': return BONE_GROUPS.rightArm;
    case 'leftArm': return BONE_GROUPS.leftArm;
    case 'arms': return [...BONE_GROUPS.leftArm,...BONE_GROUPS.rightArm];
    case 'upper': return [...BONE_GROUPS.core.slice(1,5),...BONE_GROUPS.leftArm,...BONE_GROUPS.rightArm];
    case 'lower': return [...BONE_GROUPS.leftLeg,...BONE_GROUPS.rightLeg];
    case 'head': return ['Neck','Head'];
    case 'full': return Object.values(BONE_GROUPS).flat();
    default: return [];
  }
}

export function blendPose(basePose, overlayPose, mask, weight) {
  const result={...basePose};
  const allowed=new Set(maskBoneNames(mask));
  for (const [bone,overlay] of Object.entries(overlayPose || {})) {
    if (!allowed.has(bone)) continue;
    const base=result[bone] || [0,0,0];
    result[bone]=base.map((v,i)=>v+overlay[i]*weight);
  }
  // Clamp the combined pose with the same limits used by the rig editor.
  for (const [bone,values] of Object.entries(result)) {
    const limits=JOINT_LIMITS[bone];
    if (!limits) continue;
    result[bone]=values.map((value,i)=>{
      const axis=['x','y','z'][i];
      return THREE.MathUtils.clamp(value,deg(limits[axis][0]),deg(limits[axis][1]));
    });
  }
  return result;
}

export function makeCustomPoseEvaluator(frames) {
  const sorted=[...(frames||[])].sort((a,b)=>a.time-b.time);
  return t => {
    if (!sorted.length) return {};
    if (t<=sorted[0].time) return structuredClone(sorted[0].pose);
    if (t>=sorted[sorted.length-1].time) return structuredClone(sorted[sorted.length-1].pose);
    let right=1;
    while (right<sorted.length && sorted[right].time<t) right++;
    const a=sorted[right-1], b=sorted[right];
    const u=(t-a.time)/(b.time-a.time || 1);
    const pose={};
    const names=new Set([...Object.keys(a.pose),...Object.keys(b.pose)]);
    for (const name of names) {
      const av=a.pose[name]||[0,0,0], bv=b.pose[name]||[0,0,0];
      pose[name]=av.map((v,i)=>v+(bv[i]-v)*u);
    }
    return pose;
  };
}

export function createBakedClips(avatar, customMotions=[], activeBlend=null) {
  const clips=[];
  const makeClip=(name,duration,evaluate,loop=false)=>{
    const fps=30, frameCount=Math.max(2,Math.ceil(duration*fps)+1), times=[], tracks=[];
    for (const bone of avatar.bones) {
      const values=[];
      for (let frame=0;frame<frameCount;frame++) {
        const t=Math.min(frame/fps,duration);
        const pose=evaluate(duration ? t/duration : 0);
        const rotation=pose[bone.name] || [0,0,0];
        const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0],rotation[1],rotation[2],'XYZ'));
        values.push(quaternion.x,quaternion.y,quaternion.z,quaternion.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,Array.from({length:frameCount},(_,i)=>Math.min(i/fps,duration)),values));
    }
    const clip=new THREE.AnimationClip(name,duration,tracks);
    clip.userData={loop,source:'Forma Studio procedural motion'};
    clips.push(clip);
  };
  for (const motion of MOTIONS) makeClip(motion.name,motion.duration,t=>getMotionPose(motion.name,t),motion.loop);
  for (const custom of customMotions) {
    if (!custom?.name || !custom?.frames?.length) continue;
    const evaluator=makeCustomPoseEvaluator(custom.frames);
    const last=custom.frames.reduce((m,f)=>Math.max(m,f.time),0);
    const duration=Math.max(.2,custom.duration || last || 1);
    makeClip(custom.name,duration,t=>evaluator(t),false);
  }
  if (activeBlend?.baseName && activeBlend?.overlayName) {
    const baseMotion=getMotion(activeBlend.baseName);
    const customBase=customMotions.find(item=>item.name===activeBlend.baseName);
    const duration=customBase?.duration || baseMotion.duration || 1.5;
    const baseEvaluator=customBase ? makeCustomPoseEvaluator(customBase.frames) : (t=>getMotionPose(activeBlend.baseName,t));
    const overlayEvaluator=t=>getOverlayPose(activeBlend.overlayName,t);
    makeClip(`${activeBlend.baseName} + ${activeBlend.overlayName}`,duration,t=>blendPose(baseEvaluator(t),overlayEvaluator(t),activeBlend.mask || 'arms',activeBlend.weight ?? .65),false);
  }
  return clips;
}

export function restoreAvatarPose(avatar, pose) {
  applyBonePose(avatar.bones,pose,{clamp:true});
  avatar.root.updateMatrixWorld(true);
}
