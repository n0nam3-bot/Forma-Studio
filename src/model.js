import * as THREE from 'three';

export const DEFAULT_SHAPE = Object.freeze({
  height: 100,
  shoulders: 100,
  chest: 100,
  waist: 100,
  hips: 100,
  arms: 100,
  legs: 100,
});

// Kept in the exact order that createSkeleton() inserts bones into THREE.Skeleton.
export const BONE_ORDER = [
  'Hips','Spine','SpineMid','Chest','Neck','Head',
  'Clavicle_L','UpperArm_L','LowerArm_L','Hand_L',
  'UpperLeg_L','LowerLeg_L','Foot_L','Toe_L',
  'Clavicle_R','UpperArm_R','LowerArm_R','Hand_R',
  'UpperLeg_R','LowerLeg_R','Foot_R','Toe_R',
];

export const BONE_GROUPS = {
  core: ['Hips','Spine','SpineMid','Chest','Neck','Head'],
  leftArm: ['Clavicle_L','UpperArm_L','LowerArm_L','Hand_L'],
  rightArm: ['Clavicle_R','UpperArm_R','LowerArm_R','Hand_R'],
  leftLeg: ['UpperLeg_L','LowerLeg_L','Foot_L','Toe_L'],
  rightLeg: ['UpperLeg_R','LowerLeg_R','Foot_R','Toe_R'],
};

export const JOINT_LIMITS = {
  Hips: { x: [-45,45], y: [-45,45], z: [-35,35], type: 'PELVIS · ROOT' },
  Spine: { x: [-35,35], y: [-30,30], z: [-25,25], type: 'SPINE · FLEX / TWIST' },
  SpineMid: { x: [-35,35], y: [-30,30], z: [-25,25], type: 'THORACIC · FLEX / TWIST' },
  Chest: { x: [-35,35], y: [-35,35], z: [-30,30], type: 'CHEST · TORSO' },
  Neck: { x: [-45,45], y: [-60,60], z: [-40,40], type: 'NECK · MULTI-AXIAL' },
  Head: { x: [-55,55], y: [-70,70], z: [-45,45], type: 'HEAD · MULTI-AXIAL' },
  Clavicle_L: { x: [-35,35], y: [-35,35], z: [-35,35], type: 'CLAVICLE · SHOULDER GIRDLE' },
  Clavicle_R: { x: [-35,35], y: [-35,35], z: [-35,35], type: 'CLAVICLE · SHOULDER GIRDLE' },
  UpperArm_L: { x: [-45,45], y: [-130,130], z: [-130,130], type: 'SHOULDER · BALL JOINT' },
  UpperArm_R: { x: [-45,45], y: [-130,130], z: [-130,130], type: 'SHOULDER · BALL JOINT' },
  LowerArm_L: { x: [-25,25], y: [-25,25], z: [-155,0], type: 'ELBOW · HINGE BIAS' },
  LowerArm_R: { x: [-25,25], y: [-25,25], z: [0,155], type: 'ELBOW · HINGE BIAS' },
  Hand_L: { x: [-65,65], y: [-70,70], z: [-45,45], type: 'WRIST · MULTI-AXIAL' },
  Hand_R: { x: [-65,65], y: [-70,70], z: [-45,45], type: 'WRIST · MULTI-AXIAL' },
  UpperLeg_L: { x: [-120,120], y: [-45,45], z: [-55,55], type: 'HIP · BALL JOINT' },
  UpperLeg_R: { x: [-120,120], y: [-45,45], z: [-55,55], type: 'HIP · BALL JOINT' },
  LowerLeg_L: { x: [0,145], y: [-15,15], z: [-15,15], type: 'KNEE · HINGE BIAS' },
  LowerLeg_R: { x: [0,145], y: [-15,15], z: [-15,15], type: 'KNEE · HINGE BIAS' },
  Foot_L: { x: [-45,45], y: [-25,25], z: [-25,25], type: 'ANKLE · FLEX / INVERT' },
  Foot_R: { x: [-45,45], y: [-25,25], z: [-25,25], type: 'ANKLE · FLEX / INVERT' },
  Toe_L: { x: [-35,35], y: [-15,15], z: [-15,15], type: 'TOE · FLEXION' },
  Toe_R: { x: [-35,35], y: [-15,15], z: [-15,15], type: 'TOE · FLEXION' },
};

const COLORS = {
  skin: new THREE.Color('#c7a58a'),
  skinShade: new THREE.Color('#b88f77'),
  shirt: new THREE.Color('#647d91'),
  shirtLight: new THREE.Color('#8194a2'),
  pants: new THREE.Color('#3a4b5d'),
  pantsLight: new THREE.Color('#4b5d6e'),
  shoes: new THREE.Color('#202a35'),
  eye: new THREE.Color('#202b34'),
  accent: new THREE.Color('#b9d86c'),
  neutral: new THREE.Color('#8996a7'),
};

function addBone(parent, name, position, allBones) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.copy(position);
  parent.add(bone);
  allBones.push(bone);
  return bone;
}

function createSkeleton(shape) {
  const h = shape.height / 100;
  const shoulder = shape.shoulders / 100;
  const hip = shape.hips / 100;
  const arm = shape.arms / 100;
  const leg = shape.legs / 100;
  const bones = [];

  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.set(0, .93 * h, 0);
  bones.push(hips);
  const spine = addBone(hips, 'Spine', new THREE.Vector3(0, .17*h, 0), bones);
  const spineMid = addBone(spine, 'SpineMid', new THREE.Vector3(0, .11*h, 0), bones);
  const chest = addBone(spineMid, 'Chest', new THREE.Vector3(0, .12*h, 0), bones);
  const neck = addBone(chest, 'Neck', new THREE.Vector3(0, .16*h, 0), bones);
  addBone(neck, 'Head', new THREE.Vector3(0, .17*h, 0), bones);

  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    const clavicle = addBone(chest, `Clavicle_${side}`, new THREE.Vector3(sign * .15*shoulder, .045*h, 0), bones);
    const upperArm = addBone(clavicle, `UpperArm_${side}`, new THREE.Vector3(sign * .085*shoulder, -.015*h, 0), bones);
    const lowerArm = addBone(upperArm, `LowerArm_${side}`, new THREE.Vector3(sign * .295*arm, -.025*h, 0), bones);
    addBone(lowerArm, `Hand_${side}`, new THREE.Vector3(sign * .265*arm, -.005*h, 0), bones);

    const upperLeg = addBone(hips, `UpperLeg_${side}`, new THREE.Vector3(sign * .105*hip, -.035*h, 0), bones);
    const lowerLeg = addBone(upperLeg, `LowerLeg_${side}`, new THREE.Vector3(0, -.395*h*leg, 0), bones);
    const foot = addBone(lowerLeg, `Foot_${side}`, new THREE.Vector3(0, -.385*h*leg, .035*h), bones);
    addBone(foot, `Toe_${side}`, new THREE.Vector3(0, -.015*h, .115*h), bones);
  }
  return { root: hips, bones };
}

function buildBodyGeometry(shape) {
  const h = shape.height / 100;
  const sh = shape.shoulders / 100;
  const chestVol = shape.chest / 100;
  const waist = shape.waist / 100;
  const hip = shape.hips / 100;
  const arm = shape.arms / 100;
  const leg = shape.legs / 100;
  const components = [];
  const add = (center, scale, color, rotation = null) => components.push({center:new THREE.Vector3(...center),scale:new THREE.Vector3(...scale),color,rotation:rotation||new THREE.Quaternion()});
  const addLimb = (a,b,radiusX,radiusZ,color,extra=0) => {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    const direction=end.clone().sub(start);
    const center=start.clone().add(end).multiplyScalar(.5);
    const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
    components.push({center,scale:new THREE.Vector3(radiusX,direction.length()*.5+extra,radiusZ),color,rotation});
  };
  // A smooth union of body volumes creates one continuous implicit surface rather than
  // a pile of intersecting rigid primitives.
  add([0,.94*h,0],[.205*hip,.145*h,.132*h*hip],COLORS.shirt);
  add([0,1.105*h,0],[.158*waist,.175*h,.112*h*waist],COLORS.shirtLight);
  add([0,1.325*h,0],[.205*sh*chestVol,.235*h,.139*h*chestVol],COLORS.shirt);
  add([0,1.49*h,0],[.066*sh,.10*h,.068*h],COLORS.skin);
  add([0,1.70*h,0],[.126*h,.162*h,.12*h],COLORS.skin);
  // Small embedded facial forms; they are fused into the head surface.
  add([-.044*h,1.728*h,.106*h],[.012*h,.014*h,.007*h],COLORS.eye);
  add([ .044*h,1.728*h,.106*h],[.012*h,.014*h,.007*h],COLORS.eye);
  add([0,1.686*h,.12*h],[.014*h,.024*h,.018*h],COLORS.skinShade);
  for (const sign of [-1,1]) {
    const shoulder=sign*.235*sh;
    const elbow=sign*(.235*sh+.295*arm);
    const wrist=sign*(.235*sh+.295*arm+.265*arm);
    const shoulderPoint=[shoulder,1.425*h,0];
    const elbowPoint=[elbow,1.18*h,0];
    const wristPoint=[wrist,.99*h,0];
    add([shoulder,1.425*h,0],[.092*sh,.105*h,.095*h],COLORS.shirtLight);
    addLimb(shoulderPoint,elbowPoint,.073*h,.078*h,COLORS.shirt);
    addLimb(elbowPoint,wristPoint,.061*h,.064*h,COLORS.shirtLight);
    add([wrist,.94*h,0],[.052*h,.087*h,.052*h],COLORS.skin);
    const hipX=sign*.105*hip;
    const kneeX=hipX+sign*.012;
    const ankleX=hipX+sign*.015;
    const hipPoint=[hipX,.90*h,0];
    const kneeY=(.895-.395*leg)*h;
    const ankleY=(.895-.78*leg)*h;
    const kneePoint=[kneeX,kneeY,0];
    const anklePoint=[ankleX,ankleY,0];
    addLimb(hipPoint,kneePoint,.105*hip,.112*h,COLORS.pants,.025*h);
    addLimb(kneePoint,anklePoint,.076*h,.081*h,COLORS.pantsLight,.025*h);
    add([ankleX,ankleY-.035*h,.072*h],[.083*h,.063*h,.15*h],COLORS.shoes);
    add([ankleX,ankleY-.075*h,.165*h],[.075*h,.018*h,.10*h],COLORS.accent);
  }

  const invRotations=components.map(component=>component.rotation.clone().invert());
  function componentDistance(point,index) {
    const component=components[index];
    const local=point.clone().sub(component.center).applyQuaternion(invRotations[index]);
    const rx=Math.max(component.scale.x,.0001),ry=Math.max(component.scale.y,.0001),rz=Math.max(component.scale.z,.0001);
    const nx=local.x/rx,ny=local.y/ry,nz=local.z/rz;
    const k0=Math.sqrt(nx*nx+ny*ny+nz*nz);
    const k1=Math.sqrt((local.x/(rx*rx))**2+(local.y/(ry*ry))**2+(local.z/(rz*rz))**2);
    return k1>1e-8 ? k0*(k0-1)/k1 : -Math.min(rx,ry,rz);
  }
  const blendRadius=.038*h;
  function field(point) {
    let distance=componentDistance(point,0);
    for(let i=1;i<components.length;i++) {
      const next=componentDistance(point,i);
      const k=blendRadius;
      const a=distance,b=next;
      const t=THREE.MathUtils.clamp(.5+.5*(b-a)/k,0,1);
      distance=THREE.MathUtils.lerp(b,a,t)-k*t*(1-t);
    }
    return distance;
  }
  function surfaceColor(point) {
    let nearest=0,nearestDistance=Infinity;
    for(let i=0;i<components.length;i++) {
      const distance=Math.abs(componentDistance(point,i));
      if(distance<nearestDistance){nearestDistance=distance;nearest=i;}
    }
    return components[nearest].color;
  }
  function gradient(point) {
    const epsilon=.0025;
    const dx=field(new THREE.Vector3(point.x+epsilon,point.y,point.z))-field(new THREE.Vector3(point.x-epsilon,point.y,point.z));
    const dy=field(new THREE.Vector3(point.x,point.y+epsilon,point.z))-field(new THREE.Vector3(point.x,point.y-epsilon,point.z));
    const dz=field(new THREE.Vector3(point.x,point.y,point.z+epsilon))-field(new THREE.Vector3(point.x,point.y,point.z-epsilon));
    return new THREE.Vector3(dx,dy,dz).normalize();
  }

  // Lower the extraction density on narrow/mobile layouts to limit CPU and memory spikes.
  const mobileLayout=typeof window!=='undefined' && window.matchMedia?.('(max-width: 700px)').matches;
  const spacing=mobileLayout?.052:.039;
  const min=new THREE.Vector3(-1.14*h,-.10*h,-.50*h);
  const max=new THREE.Vector3(1.14*h,2.22*h,.50*h);
  const nx=Math.ceil((max.x-min.x)/spacing)+1;
  const ny=Math.ceil((max.y-min.y)/spacing)+1;
  const nz=Math.ceil((max.z-min.z)/spacing)+1;
  const values=new Float32Array(nx*ny*nz);
  const index=(x,y,z)=>(z*ny+y)*nx+x;
  const pointAt=(x,y,z)=>new THREE.Vector3(min.x+x*spacing,min.y+y*spacing,min.z+z*spacing);
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) values[index(x,y,z)]=field(pointAt(x,y,z));

  const cubeOffsets=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const tetrahedra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const positions=[],normals=[],uvs=[],colors=[];
  const interpolate=(pa,pb,va,vb)=>{
    const amount=THREE.MathUtils.clamp(va/(va-vb || 1),0,1);
    return pa.clone().lerp(pb,amount);
  };
  const emitTriangle=(a,b,c)=>{
    const center=a.clone().add(b).add(c).multiplyScalar(1/3);
    const faceNormal=b.clone().sub(a).cross(c.clone().sub(a));
    if(faceNormal.dot(gradient(center))<0){const swap=b;b=c;c=swap;}
    for(const point of [a,b,c]) {
      const normal=gradient(point);
      const color=surfaceColor(point);
      positions.push(point.x,point.y,point.z);
      normals.push(normal.x,normal.y,normal.z);
      uvs.push(Math.atan2(point.z,point.x)/(Math.PI*2)+.5,(point.y-min.y)/(max.y-min.y));
      colors.push(color.r,color.g,color.b);
    }
  };
  const polygonise=(pts,vals)=>{
    const inside=[],outside=[];
    for(let i=0;i<4;i++) (vals[i]<0?inside:outside).push(i);
    if(inside.length===0||inside.length===4)return;
    if(inside.length===1){
      const a=inside[0];
      emitTriangle(interpolate(pts[a],pts[outside[0]],vals[a],vals[outside[0]]),interpolate(pts[a],pts[outside[1]],vals[a],vals[outside[1]]),interpolate(pts[a],pts[outside[2]],vals[a],vals[outside[2]]));
    } else if(inside.length===3){
      const a=outside[0];
      emitTriangle(interpolate(pts[a],pts[inside[0]],vals[a],vals[inside[0]]),interpolate(pts[a],pts[inside[2]],vals[a],vals[inside[2]]),interpolate(pts[a],pts[inside[1]],vals[a],vals[inside[1]]));
    } else {
      const a=inside[0],b=inside[1],c=outside[0],d=outside[1];
      const ac=interpolate(pts[a],pts[c],vals[a],vals[c]);
      const ad=interpolate(pts[a],pts[d],vals[a],vals[d]);
      const bc=interpolate(pts[b],pts[c],vals[b],vals[c]);
      const bd=interpolate(pts[b],pts[d],vals[b],vals[d]);
      emitTriangle(ac,ad,bd);emitTriangle(ac,bd,bc);
    }
  };
  for(let z=0;z<nz-1;z++) for(let y=0;y<ny-1;y++) for(let x=0;x<nx-1;x++) {
    const cubePoints=[],cubeValues=[];
    for(const offset of cubeOffsets){
      const gx=x+offset[0],gy=y+offset[1],gz=z+offset[2];
      cubePoints.push(pointAt(gx,gy,gz));cubeValues.push(values[index(gx,gy,gz)]);
    }
    for(const tetra of tetrahedra) polygonise(tetra.map(i=>cubePoints[i]),tetra.map(i=>cubeValues[i]));
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.surfaceReconstruction='smooth-union marching tetrahedra';
  return geometry;
}

function closestPointDistance(point, a, b) {
  const ab = b.clone().sub(a);
  const denom = ab.lengthSq() || 1;
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab)/denom,0,1);
  return point.distanceTo(a.clone().addScaledVector(ab,t));
}

function skinGeometry(geometry, skeleton, root) {
  root.updateMatrixWorld(true);
  const boneSegments = skeleton.bones.map((bone,index) => {
    const start = bone.getWorldPosition(new THREE.Vector3());
    const child = bone.children.find(item => item.isBone);
    const end = child ? child.getWorldPosition(new THREE.Vector3()) : start.clone();
    return {index,start,end};
  });
  const positions = geometry.getAttribute('position');
  const skinIndices = new Uint16Array(positions.count*4);
  const skinWeights = new Float32Array(positions.count*4);
  for (let i=0;i<positions.count;i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions,i);
    const nearest = boneSegments.map(segment => ({
      index: segment.index,
      distance: closestPointDistance(point,segment.start,segment.end),
    })).sort((a,b)=>a.distance-b.distance).slice(0,4);
    let total = 0;
    const weights = nearest.map(item => {
      const w = 1/Math.pow(item.distance+.035,2.6);
      total += w;
      return w;
    });
    nearest.forEach((item,j)=>{
      skinIndices[i*4+j]=item.index;
      skinWeights[i*4+j]=weights[j]/(total||1);
    });
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
}

export function createHumanoid(shape = DEFAULT_SHAPE, {neutral = false, name = 'Character', geometryOverride = null} = {}) {
  const params = {...DEFAULT_SHAPE,...shape};
  const root = new THREE.Group();
  root.name = `${name}_Root`;
  const {root: hips, bones} = createSkeleton(params);
  root.add(hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const geometry = geometryOverride ? geometryOverride.clone() : buildBodyGeometry(params);
  if (!geometry.getAttribute('skinIndex')) skinGeometry(geometry,skeleton,root);
  const material = new THREE.MeshStandardMaterial({
    vertexColors:!neutral, color:neutral?new THREE.Color('#9eacbb'):new THREE.Color('#ffffff'), roughness:.76, metalness:.015,
    side:THREE.DoubleSide,
  });
  const mesh = new THREE.SkinnedMesh(geometry,material);
  mesh.name = `${name}_Body`;
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  const skeletonHelper = new THREE.SkeletonHelper(root);
  skeletonHelper.name = `${name}_SkeletonHelper`;
  skeletonHelper.material = new THREE.LineBasicMaterial({color:0x86a9ff,transparent:true,opacity:.92,depthTest:false});
  skeletonHelper.visible = false;
  skeletonHelper.renderOrder = 10;
  root.add(skeletonHelper);
  root.userData.isFormaHumanoid = true;
  root.userData.shape = params;
  root.userData.boneNames = bones.map(b=>b.name);
  return {root,mesh,skeleton,bones,boneMap:Object.fromEntries(bones.map(b=>[b.name,b])),helper:skeletonHelper,shape:params,neutral};
}

export function getBoneLocalPose(bones) {
  const pose = {};
  bones.forEach(bone => pose[bone.name] = [bone.rotation.x,bone.rotation.y,bone.rotation.z]);
  return pose;
}

export function resetBonePose(bones) {
  bones.forEach(bone => bone.rotation.set(0,0,0));
}

export function applyBonePose(bones, pose, {clamp = true} = {}) {
  const map = Object.fromEntries(bones.map(b=>[b.name,b]));
  for (const [name,rotation] of Object.entries(pose || {})) {
    const bone = map[name];
    if (!bone) continue;
    const limits = JOINT_LIMITS[name];
    const values = rotation.map((value,index)=>{
      if (!clamp || !limits) return value;
      const axis = ['x','y','z'][index];
      const [min,max] = limits[axis].map(THREE.MathUtils.degToRad);
      return THREE.MathUtils.clamp(value,min,max);
    });
    bone.rotation.set(values[0],values[1],values[2],'XYZ');
  }
}

export function clampBoneRotation(name, values) {
  const limits = JOINT_LIMITS[name];
  if (!limits) return values;
  return values.map((value,index)=>{
    const axis=['x','y','z'][index];
    const [min,max]=limits[axis];
    return THREE.MathUtils.clamp(value,min,max);
  });
}

export function createRestPose(bones) {
  return Object.fromEntries(bones.map(bone=>[bone.name,[0,0,0]]));
}
