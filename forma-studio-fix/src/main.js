import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  DEFAULT_SHAPE, JOINT_LIMITS, createHumanoid,
  getBoneLocalPose, resetBonePose, applyBonePose, clampBoneRotation,
} from './model.js';
import {
  MOTIONS, getMotion, getMotionPose, getOverlayPose, blendPose,
  createBakedClips, makeCustomPoseEvaluator,
} from './motion.js';
import { saveLocalProject, loadLocalProject, readFileAsDataURL, downloadBlob, downloadJSON } from './persistence.js';

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const state = {
  shape:{...DEFAULT_SHAPE},
  references:[],
  referenceSlots:[
    {role:'front',label:'Front',required:true},
    {role:'side',label:'Side',required:true},
    {role:'back',label:'Back',required:false},
    {role:'threeQuarter',label:'3/4 view',required:false},
  ],
  meshMode:'fitted', importedRoot:null, importedAnimations:[], importedFileName:'', importedPointCloud:false,
  customMotions:[], draftFrames:[],
  baseMotion:'Idle', overlayMotion:'', overlayMask:'arms', blendWeight:.65,
  progress:0, playing:false, speed:1, activePage:'build', selectedBone:'Hips', showSkeleton:false,
  projectName:'Untitled character', exporting:false,
};

const views = {};
let buildAvatar, rigAvatar, sourceAvatar, resultAvatar, exportAvatar;
let lastFrame=0, lastToast=0, resizeObserver;
let objectUrlToRevoke=null;

function toast(message,type='success',duration=3500) {
  const region=$('#toastRegion');
  const item=document.createElement('div');
  item.className=`toast ${type}`;
  item.textContent=message;
  region.appendChild(item);
  setTimeout(()=>item.remove(),duration);
}

function createView(canvas,{targetY=1.0,camera='three',showGrid=true}={}) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:window.innerWidth<720?'low-power':'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,window.innerWidth<720?1.25:1.7));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.18;
  renderer.setClearColor(0x000000,0);
  const scene=new THREE.Scene();
  const cameraObj=new THREE.PerspectiveCamera(34,1,.08,80);
  const controls=new OrbitControls(cameraObj,canvas);
  controls.enableDamping=true;
  controls.dampingFactor=.075;
  controls.enablePan=false;
  controls.minDistance=1.8;
  controls.maxDistance=8;
  controls.target.set(0,targetY,0);
  controls.update();
  scene.add(new THREE.HemisphereLight(0xe5efff,0x39404a,2.05));
  const key=new THREE.DirectionalLight(0xfff3df,2.35); key.position.set(-3.5,5,4); scene.add(key);
  const fill=new THREE.DirectionalLight(0xa8c4ff,1.05); fill.position.set(4,2.6,-3); scene.add(fill);
  const rim=new THREE.DirectionalLight(0xd4ed9a,.6); rim.position.set(0,3,-4); scene.add(rim);
  if (showGrid) {
    const grid=new THREE.GridHelper(5,28,0x526071,0x2a3441);
    grid.position.y=.012;
    grid.material.transparent=true;
    grid.material.opacity=.5;
    scene.add(grid);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:0x10151c,transparent:true,opacity:.18,side:THREE.DoubleSide}));
    floor.rotation.x=-Math.PI/2; floor.position.y=-.005; scene.add(floor);
  }
  const view={canvas,renderer,scene,camera:cameraObj,controls,model:null,disposed:false};
  setCamera(view,camera);
  const resize=()=>{
    if (view.disposed) return;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(1,Math.floor(rect.width));
    const height=Math.max(1,Math.floor(rect.height));
    renderer.setSize(width,height,false);
    cameraObj.aspect=width/height; cameraObj.updateProjectionMatrix();
  };
  if (typeof ResizeObserver!=='undefined') {
    const ro=new ResizeObserver(resize); ro.observe(canvas); view.resizeObserver=ro;
  } else window.addEventListener('resize',resize);
  requestAnimationFrame(resize);
  view.resize=resize;
  return view;
}

function setCamera(view,type='three') {
  const target=view.controls.target;
  target.set(0,1.0,0);
  if (type==='front') view.camera.position.set(0,1.05,4.4);
  else if (type==='side') view.camera.position.set(4.4,1.05,0);
  else view.camera.position.set(2.8,2.0,3.9);
  view.camera.lookAt(target);
  view.controls.update();
}

function setViewModel(view,root) {
  if (!view) return;
  if (view.model) view.scene.remove(view.model);
  view.model=root || null;
  if (root) view.scene.add(root);
  view.resize();
}

function renderView(view) {
  if (!view || view.disposed) return;
  view.controls.update();
  if (view.model) view.model.updateMatrixWorld(true);
  view.renderer.render(view.scene,view.camera);
}

function disposeAvatar(avatar) {
  if (!avatar) return;
  avatar.root.traverse(object=>{
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      const materials=Array.isArray(object.material)?object.material:[object.material];
      materials.forEach(material=>material.dispose());
    }
  });
}

function createAllAvatars() {
  [buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].forEach(disposeAvatar);
  buildAvatar=createHumanoid(state.shape,{name:'BuildCharacter'});
  const sharedGeometry=buildAvatar.mesh.geometry;
  rigAvatar=createHumanoid(state.shape,{name:'RigCharacter',geometryOverride:sharedGeometry});
  sourceAvatar=createHumanoid(state.shape,{neutral:true,name:'SourceMotionRig',geometryOverride:sharedGeometry});
  resultAvatar=createHumanoid(state.shape,{name:'ResultCharacter',geometryOverride:sharedGeometry});
  exportAvatar=createHumanoid(state.shape,{name:'ExportCharacter',geometryOverride:sharedGeometry});
  if (views.build) setViewModel(views.build,buildAvatar.root);
  if (views.rig) setViewModel(views.rig,rigAvatar.root);
  if (views.source) setViewModel(views.source,sourceAvatar.root);
  if (views.result) setViewModel(views.result,resultAvatar.root);
  if (views.export) setViewModel(views.export,exportAvatar.root);
  if (state.showSkeleton) setSkeletonVisibility(true);
  updateAvatarPose(buildAvatar,getMotionPose('Idle',0));
  updateAvatarPose(exportAvatar,getMotionPose('Idle',0));
  updateAvatarPose(sourceAvatar,getMotionPose(state.baseMotion,state.progress));
  updateAvatarPose(resultAvatar,evaluateResultPose(state.progress));
  updateBoneControls();
}

function updateAvatarPose(avatar,pose) {
  if (!avatar) return;
  resetBonePose(avatar.bones);
  applyBonePose(avatar.bones,pose,{clamp:true});
  avatar.root.updateMatrixWorld(true);
  avatar.helper.update();
}

function setSkeletonVisibility(visible) {
  state.showSkeleton=visible;
  [buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].forEach(avatar=>{if(avatar?.helper)avatar.helper.visible=visible;});
  $('#toggleSkeleton').classList.toggle('active',visible);
  $('#rigToggleBones').classList.toggle('active',visible);
}

function getCustomMotion(name) { return state.customMotions.find(m=>m.name===name); }
function isMotionLoop(name) { return getCustomMotion(name)?.loop ?? getMotion(name).loop; }
function getDuration(name) { return getCustomMotion(name)?.duration || getMotion(name).duration || 2; }
function evaluateBasePose(progress) {
  const custom=getCustomMotion(state.baseMotion);
  if (custom) return makeCustomPoseEvaluator(custom.frames)(progress);
  return getMotionPose(state.baseMotion,progress);
}
function evaluateResultPose(progress) {
  const base=evaluateBasePose(progress);
  if (!state.overlayMotion) return base;
  const overlay=getOverlayPose(state.overlayMotion,progress);
  return blendPose(base,overlay,state.overlayMask,state.blendWeight);
}

function createViews() {
  try {
    views.build=createView($('#buildCanvas'),{targetY:1.02,camera:'three'});
    views.rig=createView($('#rigCanvas'),{targetY:1.02,camera:'front'});
    views.source=createView($('#sourceCanvas'),{targetY:1.02,camera:'front'});
    views.result=createView($('#resultCanvas'),{targetY:1.02,camera:'front'});
    views.export=createView($('#exportCanvas'),{targetY:1.02,camera:'three'});
    createAllAvatars();
    $('#viewportLoading').classList.add('hidden');
  } catch (error) {
    console.error('WebGL initialization failed',error);
    const loading=$('#viewportLoading');
    loading.innerHTML='<strong>3D preview unavailable</strong><span>Enable WebGL in this browser or try a desktop browser with hardware acceleration.</span>';
    toast('This browser could not start WebGL. The editing panels remain available, but 3D export needs the 3D engine.','error',7000);
  }
}

function initNavigation() {
  $$('.nav-item[data-page]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page)));
  $('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
}

function navigate(page) {
  state.activePage=page;
  $$('.nav-item[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  $$('[data-page-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.pagePanel===page));
  $('#sidebar').classList.remove('open');
  requestAnimationFrame(()=>{
    Object.values(views).forEach(view=>view?.resize());
  });
  if (page==='rig') updateBoneControls();
  if (page==='animate') { syncMotionUI(); setProgressUI(); }
  if (page==='export') $('#exportCharacterName').textContent=state.projectName;
}

function initCameraControls() {
  $$('.camera-switch button').forEach(button=>button.addEventListener('click',()=>{
    $$('.camera-switch button').forEach(item=>item.classList.toggle('active',item===button));
    const type=button.dataset.camera;
    if(views.build)setCamera(views.build,type);
    if(views.rig)setCamera(views.rig,type);
    if(views.export)setCamera(views.export,type);
  }));
  $('#resetCamera').addEventListener('click',()=>setCamera(views.build,'three'));
  $('#toggleSkeleton').addEventListener('click',()=>setSkeletonVisibility(!state.showSkeleton));
  $('#rigToggleBones').addEventListener('click',()=>setSkeletonVisibility(!state.showSkeleton));
}

function initShapeControls() {
  const keys={height:'height',shoulder:'shoulders',chest:'chest',waist:'waist',hip:'hips',arm:'arms',leg:'legs'};
  for (const [prefix,key] of Object.entries(keys)) {
    const input=$(`#${prefix}Range`), output=$(`#${prefix}Out`);
    input.addEventListener('input',()=>{output.value=`${input.value}%`;output.textContent=`${input.value}%`;});
  }
  const presets={
    balanced:{...DEFAULT_SHAPE},
    athletic:{...DEFAULT_SHAPE,shoulders:118,chest:112,waist:88,hips:98,arms:105,legs:103},
    stylized:{...DEFAULT_SHAPE,height:104,shoulders:92,chest:92,waist:88,hips:108,arms:95,legs:112},
  };
  $$('.preset').forEach(button=>button.addEventListener('click',()=>{
    $$('.preset').forEach(b=>b.classList.toggle('active',b===button));
    setShapeUI(presets[button.dataset.preset]);
    state.shape={...presets[button.dataset.preset]};
    applyShape();
  }));
  $('#resetShape').addEventListener('click',()=>{state.shape={...DEFAULT_SHAPE};setShapeUI(state.shape);applyShape();$$('.preset').forEach(b=>b.classList.toggle('active',b.dataset.preset==='balanced'));});
  $('#applyShape').addEventListener('click',()=>{
    state.shape={height:+$('#heightRange').value,shoulders:+$('#shoulderRange').value,chest:+$('#chestRange').value,waist:+$('#waistRange').value,hips:+$('#hipRange').value,arms:+$('#armRange').value,legs:+$('#legRange').value};
    applyShape();
  });
}

function setShapeUI(shape) {
  const ids={height:'height',shoulders:'shoulder',chest:'chest',waist:'waist',hips:'hip',arms:'arm',legs:'leg'};
  for (const [key,prefix] of Object.entries(ids)) {
    const input=$(`#${prefix}Range`),output=$(`#${prefix}Out`);
    input.value=shape[key]; output.value=`${shape[key]}%`; output.textContent=`${shape[key]}%`;
  }
}

function applyShape() {
  if (state.meshMode==='imported') {
    state.meshMode='fitted';
    state.importedRoot=null; state.importedAnimations=[]; state.importedPointCloud=false;
    updateSourceChoice();
  }
  createAllAvatars();
  $('#meshStats').textContent='22 BONES · 1 SKINNED MESH';
  $('#modelSourceLabel').textContent='PARAMETRIC HUMANOID · SKINNED';
  $('#viewportHint').textContent='Proportions applied · refine joint placement in Rig & pose';
  toast('Proportions applied. The generated mesh and skeleton have been rebuilt.');
}

function initRigControls() {
  $$('.bone-row').forEach(button=>button.addEventListener('click',()=>selectBone(button.dataset.bone)));
  $('#boneSearch').addEventListener('input',()=>{
    const query=$('#boneSearch').value.toLowerCase();
    $$('.bone-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(query));
  });
  for (const axis of ['X','Y','Z']) {
    $(`#rot${axis}`).addEventListener('input',()=>{
      if (!rigAvatar) return;
      const bone=rigAvatar.boneMap[state.selectedBone];
      if (!bone) return;
      const limits=JOINT_LIMITS[state.selectedBone]?.[axis.toLowerCase()] || [-60,60];
      const degrees=Math.max(limits[0],Math.min(limits[1],Number($(`#rot${axis}`).value)));
      bone.rotation[axis.toLowerCase()]=THREE.MathUtils.degToRad(degrees);
      $(`#rot${axis}Out`).textContent=`${Math.round(degrees)}°`;
      rigAvatar.root.updateMatrixWorld(true); rigAvatar.helper.update();
    });
  }
  $('#resetJoint').addEventListener('click',()=>{
    const bone=rigAvatar?.boneMap[state.selectedBone];
    if (!bone) return;
    bone.rotation.set(0,0,0); updateBoneControls(); rigAvatar.helper.update();
  });
  $('#rigResetPose').addEventListener('click',()=>{
    resetBonePose(rigAvatar.bones); rigAvatar.root.updateMatrixWorld(true); rigAvatar.helper.update(); updateBoneControls();
    toast('Rig pose reset to the rest pose.','info');
  });
}

function selectBone(name) {
  if (!rigAvatar?.boneMap[name]) return;
  state.selectedBone=name;
  $$('.bone-row').forEach(row=>row.classList.toggle('active',row.dataset.bone===name));
  updateBoneControls();
}

function updateBoneControls() {
  if (!rigAvatar) return;
  const bone=rigAvatar.boneMap[state.selectedBone] || rigAvatar.bones[0];
  state.selectedBone=bone.name;
  $('#selectedBoneTitle').textContent=bone.name.replaceAll('_',' ');
  $('#selectedBoneReadout').textContent=bone.name.replaceAll('_',' ');
  $('#jointTypeReadout').textContent=JOINT_LIMITS[bone.name]?.type || 'JOINT';
  let axisLabels=['X · FLEX / EXTEND','Y · TWIST','Z · ABDUCT / ADDUCT'];
  if (bone.name.startsWith('UpperArm')) axisLabels=['X · INTERNAL / EXTERNAL ROTATION','Y · SHOULDER FLEX / EXTEND','Z · SHOULDER ABDUCT / ADDUCT'];
  else if (bone.name.startsWith('LowerArm')) axisLabels=['X · FOREARM ROTATION','Y · RADIAL / ULNAR DEVIATION','Z · ELBOW FLEXION'];
  else if (bone.name.startsWith('UpperLeg')) axisLabels=['X · HIP FLEX / EXTEND','Y · HIP ROTATION','Z · HIP ABDUCT / ADDUCT'];
  else if (bone.name.startsWith('LowerLeg')) axisLabels=['X · KNEE FLEXION','Y · TIBIAL ROTATION','Z · KNEE VARUS / VALGUS'];
  else if (bone.name.startsWith('Foot') || bone.name.startsWith('Toe')) axisLabels=['X · DORSI / PLANTAR FLEX','Y · INVERSION / EVERSION','Z · TOE / FOOT ROTATION'];
  ['X','Y','Z'].forEach((axis,index)=>{$(`label[for=rot${axis}]`).textContent=axisLabels[index];});
  for (const axis of ['X','Y','Z']) {
    const key=axis.toLowerCase(),slider=$(`#rot${axis}`),output=$(`#rot${axis}Out`);
    const limits=JOINT_LIMITS[bone.name]?.[key] || [-60,60];
    slider.min=limits[0]; slider.max=limits[1];
    const value=Math.round(THREE.MathUtils.radToDeg(bone.rotation[key]));
    slider.value=Math.max(limits[0],Math.min(limits[1],value));
    output.textContent=`${value}°`;
    slider.setAttribute('aria-label',`${bone.name} ${axis} rotation, range ${limits[0]} to ${limits[1]} degrees`);
  }
}

function isSupportedReferenceImage(file) {
  const name=String(file?.name||'').toLowerCase();
  const type=String(file?.type||'').toLowerCase();
  return /\.(png|jpe?g|webp|avif)$/i.test(name) || ['image/png','image/jpeg','image/webp','image/avif'].includes(type);
}

function initReferences() {
  renderReferenceGrid();
  $('#addReference').addEventListener('click',()=>{
    if(state.referenceSlots.length>=8){toast('The reference set is limited to eight views.','info');return;}
    const n=state.referenceSlots.length+1;
    state.referenceSlots.push({role:`angle${n}`,label:`Angle ${n}`,required:false});
    renderReferenceGrid();
    toast('Reference slot added.','info');
  });
  $('#fitReferences').addEventListener('click',()=>fitProportionsFromReferences());
}

function renderReferenceGrid() {
  const grid=$('#referenceGrid'); grid.innerHTML='';
  for (const slot of state.referenceSlots) {
    const ref=state.references.find(item=>item.role===slot.role);
    const label=document.createElement('label');
    label.className=`reference-slot ${slot.required?'primary-slot':''} ${ref?'has-image':''}`;
    label.dataset.role=slot.role;
    const input=document.createElement('input');
    input.type='file'; input.accept='image/*'; input.className='reference-file-input'; input.removeAttribute('hidden');
    input.addEventListener('change',async()=>{
      const file=input.files?.[0]; if(!file)return;
      if(file.size>20*1024*1024){toast('Choose an image smaller than 20 MB.','error');input.value='';return;}
      if(!isSupportedReferenceImage(file)){toast('Choose a supported image (PNG, JPG, WebP or AVIF).','error');input.value='';return;}
      try {
        const dataUrl=await readFileAsDataURL(file);
        state.references=state.references.filter(item=>item.role!==slot.role);
        state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});
        renderReferenceGrid();
        toast(`${slot.label} reference added locally. No upload was made.`);
      } catch(error){toast(error.message,'error');}
    });
    label.appendChild(input);
    if(ref) {
      const img=document.createElement('img'); img.src=ref.dataUrl; img.alt=`${slot.label} reference`; label.appendChild(img);
      const badge=document.createElement('span'); badge.className='slot-label'; badge.textContent=slot.label.toUpperCase(); label.appendChild(badge);
      const remove=document.createElement('button'); remove.type='button'; remove.className='slot-remove'; remove.textContent='×'; remove.setAttribute('aria-label',`Remove ${slot.label} reference`);
      remove.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();state.references=state.references.filter(item=>item.role!==slot.role);renderReferenceGrid();});
      label.appendChild(remove);
    } else {
      const add=document.createElement('span');add.className='slot-add';add.textContent='＋';label.appendChild(add);
      const title=document.createElement('strong');title.textContent=slot.label;label.appendChild(title);
      const sub=document.createElement('small');sub.textContent=slot.required?'Required':'Optional';label.appendChild(sub);
    }
    label.addEventListener('dragover',event=>{event.preventDefault();label.style.borderColor='var(--accent)';});
    label.addEventListener('dragleave',()=>{label.style.borderColor='';});
    label.addEventListener('drop',async event=>{
      event.preventDefault();label.style.borderColor='';
      const file=event.dataTransfer.files?.[0];
      if(!file || !isSupportedReferenceImage(file))return;
      if(file.size>20*1024*1024){toast('Choose an image smaller than 20 MB.','error');return;}
      try{const dataUrl=await readFileAsDataURL(file);state.references=state.references.filter(item=>item.role!==slot.role);state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});renderReferenceGrid();toast(`${slot.label} reference added locally.`);}catch(error){toast(error.message,'error');}
    });
    grid.appendChild(label);
  }
  $('#referenceCount').textContent=`${state.references.length} / 8`;
}


async function measureReferenceSilhouette(reference) {
  const image=new Image();
  image.src=reference.dataUrl;
  if(image.decode) await image.decode();
  else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});
  const scale=Math.min(1,320/Math.max(image.naturalWidth,image.naturalHeight));
  const width=Math.max(1,Math.round(image.naturalWidth*scale));
  const height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(image,0,0,width,height);
  const pixels=context.getImageData(0,0,width,height).data;
  const border=[];
  const stride=Math.max(1,Math.floor(Math.min(width,height)/80));
  for(let x=0;x<width;x+=stride){
    for(const y of [0,height-1]){const i=(y*width+x)*4;border.push([pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]]);}
  }
  for(let y=0;y<height;y+=stride){
    for(const x of [0,width-1]){const i=(y*width+x)*4;border.push([pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]]);}
  }
  const transparent=border.filter(p=>p[3]<180).length>border.length*.65;
  const bg=[0,0,0];
  if(!transparent){for(const p of border){bg[0]+=p[0];bg[1]+=p[1];bg[2]+=p[2];}bg.forEach((_,i)=>bg[i]/=border.length);}
  let minX=width,minY=height,maxX=-1,maxY=-1,count=0;
  const rowMin=new Int32Array(height);rowMin.fill(width);
  const rowMax=new Int32Array(height);rowMax.fill(-1);
  const threshold=46;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(pixels[i+3]<36)continue;
      let foreground;
      if(transparent) foreground=pixels[i+3]>180;
      else {
        const dr=pixels[i]-bg[0],dg=pixels[i+1]-bg[1],db=pixels[i+2]-bg[2];
        foreground=Math.sqrt(dr*dr+dg*dg+db*db)>threshold;
      }
      if(!foreground)continue;
      count++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      if(x<rowMin[y])rowMin[y]=x;if(x>rowMax[y])rowMax[y]=x;
    }
  }
  const boxWidth=maxX-minX+1,boxHeight=maxY-minY+1;
  if(boxWidth<12||boxHeight<40||count<width*height*.008||count>width*height*.78) throw new Error(`${reference.label} view could not be isolated. Use a plain contrasting background and keep the full character inside the frame.`);
  const spanAt=(ratio)=>{
    const center=Math.round(minY+boxHeight*ratio);
    const radius=Math.max(2,Math.round(boxHeight*.012));
    const spans=[];
    for(let y=Math.max(minY,center-radius);y<=Math.min(maxY,center+radius);y++){
      if(rowMax[y]>=rowMin[y])spans.push(rowMax[y]-rowMin[y]+1);
    }
    spans.sort((a,b)=>a-b);
    return spans.length?spans[Math.floor(spans.length/2)]/boxHeight:0;
  };
  const waistCandidates=[];
  for(let ratio=.34;ratio<=.49;ratio+=.015)waistCandidates.push({ratio,width:spanAt(ratio)});
  const waistMinimum=waistCandidates.reduce((best,item)=>item.width<best.width?item:best,waistCandidates[0]);
  let hipLine=.50;
  for(let ratio=waistMinimum.ratio+.035;ratio<=.67;ratio+=.015){if(spanAt(ratio)>waistMinimum.width*1.16){hipLine=ratio;break;}}
  const coverage=count/(width*height);
  return {
    widthHeight:boxWidth/boxHeight,
    shoulder:spanAt(.24),chest:spanAt(.29),waist:spanAt(.405),hips:spanAt(.50),hipLine,coverage,
    confidence:Math.max(0,Math.min(1,.45+Math.min(coverage,.3)*1.2+(boxHeight/height)*.2)),
  };
}

async function fitProportionsFromReferences() {
  const front=state.references.find(item=>item.role==='front');
  const side=state.references.find(item=>item.role==='side');
  if(!front||!side){toast('Add both a front and a side reference before fitting proportions.','error');return;}
  const button=$('#fitReferences');
  button.disabled=true;button.textContent='Measuring silhouettes…';
  try {
    const [f,s]=await Promise.all([measureReferenceSilhouette(front),measureReferenceSilhouette(side)]);
    const clamp=(value,min,max)=>Math.round(Math.max(min,Math.min(max,value)));
    const frontChest=f.chest/.22*100,sideChest=s.chest/.15*100;
    const frontWaist=f.waist/.17*100,sideWaist=s.waist/.12*100;
    const frontHips=f.hips/.22*100,sideHips=s.hips/.142*100;
    const next={
      ...state.shape,
      shoulders:clamp(f.shoulder/.35*100,75,135),
      chest:clamp(Math.sqrt(Math.max(1,frontChest)*Math.max(1,sideChest)),70,135),
      waist:clamp(Math.sqrt(Math.max(1,frontWaist)*Math.max(1,sideWaist)),70,135),
      hips:clamp(Math.sqrt(Math.max(1,frontHips)*Math.max(1,sideHips)),75,140),
      legs:clamp((1-f.hipLine)/.505*100,80,120),
    };
    state.shape=next;setShapeUI(next);applyShape();
    const confidence=Math.round((f.confidence+s.confidence)*50);
    toast(`Silhouette fit applied (${confidence}% capture confidence). Review and adjust the proportions manually; hidden surfaces are still inferred.`,confidence<60?'info':'success',6500);
  } catch(error) {
    toast(error.message||'Could not measure these reference images.','error',6500);
  } finally {
    button.disabled=false;button.innerHTML='Fit proportions from views <span>↗</span>';
  }
}

function updateSourceChoice() {
  $$('.source-choice').forEach(choice=>choice.classList.toggle('selected',(choice.dataset.source||'imported')===state.meshMode));
  if(state.meshMode==='imported') {
    $('#modelSourceLabel').textContent='IMPORTED MESH · PREVIEW';
    $('#meshStats').textContent='IMPORTED GEOMETRY · ORIGINAL TOPOLOGY';
    $('#viewportHint').textContent='Imported mesh preview · use the generated rig for procedural editing';
  } else {
    $('#modelSourceLabel').textContent='PARAMETRIC HUMANOID · SKINNED';
    $('#meshStats').textContent='22 BONES · 1 SKINNED MESH';
    $('#viewportHint').textContent='Select a proportion to shape the model';
  }
}

function normalizeImportedModel(root) {
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root);
  const size=box.getSize(new THREE.Vector3());
  const height=Math.max(size.y,.001);
  const scale=1.85/height;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const scaledBox=new THREE.Box3().setFromObject(root);
  const center=scaledBox.getCenter(new THREE.Vector3());
  root.position.x-=center.x;
  root.position.z-=center.z;
  root.position.y-=scaledBox.min.y;
  root.updateMatrixWorld(true);
  return root;
}

async function importMeshFile(file) {
  if(!file)return;
  const extension=file.name.split('.').pop().toLowerCase();
  try {
    let root=null, animations=[];
    if(extension==='glb') {
      const buffer=await file.arrayBuffer();
      const loader=new GLTFLoader();
      const gltf=await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
      root=gltf.scene; animations=gltf.animations||[];
    } else if(extension==='gltf') {
      throw new Error('For reliable local import, export the model as a single-file .glb. Separate .gltf assets may reference external files that cannot be resolved from one upload.');
    } else if(extension==='obj') {
      const text=await file.text();
      root=new OBJLoader().parse(text);
      root.traverse(obj=>{if(obj.isMesh){if(!obj.material || obj.material.type==='MeshPhongMaterial')obj.material=new THREE.MeshStandardMaterial({color:0x9aa9b6,roughness:.8});}});
    } else if(extension==='ply') {
      const geometry=new PLYLoader().parse(await file.arrayBuffer());
      if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
      if(!geometry.index) {
        const points=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xc6d1dd,size:.008,sizeAttenuation:true}));
        root=new THREE.Group();root.name='ImportedPointCloud';root.add(points);
      } else {
        root=new THREE.Group();
        root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xa8b6c4,roughness:.78,vertexColors:!!geometry.getAttribute('color')})));
      }
    } else throw new Error('Supported inputs: GLB, OBJ or PLY.');
    if(!root)throw new Error('No model geometry was found in that file.');
    root.name=root.name||file.name.replace(/\.[^.]+$/,'');
    normalizeImportedModel(root);
    state.importedRoot=root;
    state.importedPointCloud=extension==='ply' && !!root.getObjectByProperty('isPoints',true);
    state.importedAnimations=animations;
    state.importedFileName=file.name;
    state.meshMode='imported';
    updateSourceChoice();
    const buildClone=cloneImported(root),exportClone=cloneImported(root);
    setViewModel(views.build,buildClone);
    setViewModel(views.export,exportClone);
    $('#exportCharacterName').textContent=state.projectName;
    const hasSkin=root.getObjectByProperty('isSkinnedMesh',true);
    if(animations.length) {
      toast(`Imported ${file.name}. ${animations.length} embedded animation clip(s) detected; the file will export with its existing animation data.`);
    } else if(hasSkin) {
      toast(`Imported ${file.name}. A skinned mesh was found; embedded motion clips were not present.`, 'info');
    } else {
      toast(`Imported ${file.name} for mesh preview and GLB packaging. This mesh is not auto-rigged; the humanoid rig editor remains available for the generated base.`, 'info',6500);
    }
  } catch(error) {
    console.error(error);
    toast(error.message||'Could not import this mesh.','error',6500);
  }
}

function cloneImported(root) {
  try { return cloneSkinned(root); } catch { return root.clone(true); }
}

function initMeshImport() {
  $('#meshImport').addEventListener('change',event=>importMeshFile(event.target.files?.[0]));
  $$('.source-choice').forEach(choice=>choice.addEventListener('click',()=>{
    if(choice.dataset.source==='fitted') {
      state.meshMode='fitted';state.importedRoot=null;state.importedAnimations=[];state.importedPointCloud=false;updateSourceChoice();
      setViewModel(views.build,buildAvatar?.root);setViewModel(views.export,exportAvatar?.root);
    }
  }));
}

function initMotionUI() {
  $$('.motion-card').forEach(button=>button.addEventListener('click',()=>selectMotion(button.dataset.motion)));
  $$('#motionFilters button').forEach(button=>button.addEventListener('click',()=>{
    $$('#motionFilters button').forEach(item=>item.classList.toggle('active',item===button));
    filterMotionCards(button.dataset.filter);
  }));
  $('#playMotion').addEventListener('click',()=>{
    if(!state.playing && !isMotionLoop(state.baseMotion) && state.progress>=.999)state.progress=0;
    state.playing=!state.playing;updatePlayButton();
  });
  $('#stopMotion').addEventListener('click',()=>{state.playing=false;state.progress=0;updatePlayButton();setProgressUI();});
  $('#timelineRange').addEventListener('input',()=>{state.playing=false;state.progress=Number($('#timelineRange').value)/1000;updatePlayButton();setProgressUI();applyMotionPreview();});
  $('#playSpeed').addEventListener('change',()=>state.speed=Number($('#playSpeed').value));
  $('#overlaySelect').addEventListener('change',()=>{
    state.overlayMotion=$('#overlaySelect').value;
    if(state.overlayMotion==='Head Nod')state.overlayMask='head';
    else if(state.overlayMotion==='Breathing')state.overlayMask='upper';
    else if(state.overlayMotion)state.overlayMask='arms';
    $('#maskSelect').value=state.overlayMask;
    syncMotionUI();applyMotionPreview();
  });
  $('#maskSelect').addEventListener('change',()=>{state.overlayMask=$('#maskSelect').value;syncMotionUI();applyMotionPreview();});
  $('#blendRange').addEventListener('input',()=>{state.blendWeight=Number($('#blendRange').value)/100;$('#blendOut').textContent=`${Math.round(state.blendWeight*100)}%`;applyMotionPreview();});
  $('#clearOverlay').addEventListener('click',()=>{state.overlayMotion='';$('#overlaySelect').value='';syncMotionUI();applyMotionPreview();});
  $('#addKeyframe').addEventListener('click',()=>{
    if(!rigAvatar)return;
    const frame={time:state.progress,pose:getBoneLocalPose(rigAvatar.bones)};
    const existing=state.draftFrames.findIndex(item=>Math.abs(item.time-frame.time)<.02);
    if(existing>=0)state.draftFrames[existing]=frame;else state.draftFrames.push(frame);
    state.draftFrames.sort((a,b)=>a.time-b.time);
    toast(`Keyframe added at ${(state.progress*100).toFixed(0)}% of the timeline.`,'info');
  });
  $('#saveCustomMotion').addEventListener('click',()=>saveCustomMotion());
  $('#blendOut').textContent='65%';
}

function selectMotion(name) {
  state.baseMotion=name;
  state.progress=0;
  state.playing=true;
  $$('.motion-card').forEach(card=>card.classList.toggle('active',card.dataset.motion===name));
  syncMotionUI();setProgressUI();updatePlayButton();applyMotionPreview();
}

function filterMotionCards(filter) {
  $$('.motion-card').forEach(card=>{
    const category=card.dataset.category || getCustomMotion(card.dataset.motion)?.category || getMotion(card.dataset.motion).category;
    card.hidden=filter!=='all' && category!==filter;
  });
}

function renderCustomMotionCards() {
  const grid=$('#motionGrid');
  $$('.motion-card[data-custom="true"]',grid).forEach(card=>card.remove());
  for (const custom of state.customMotions) {
    const button=document.createElement('button');button.className='motion-card';button.dataset.motion=custom.name;button.dataset.custom='true';button.dataset.category='gesture';button.type='button';
    button.innerHTML='<span class="motion-card-icon">⌁</span><strong></strong><small>Custom · saved</small>';
    $('strong',button).textContent=custom.name;
    button.addEventListener('click',()=>selectMotion(custom.name));
    grid.appendChild(button);
  }
  $('#motionCount').textContent=`${MOTIONS.length+state.customMotions.length} CLIPS`;
  const active=$(`.motion-card[data-motion="${CSS.escape(state.baseMotion)}"]`);
  if(active)active.classList.add('active');
}

function saveCustomMotion() {
  if(state.draftFrames.length<2){toast('Add at least two keyframes at different timeline positions before saving a motion.','error');return;}
  const name=window.prompt('Name this motion:','My motion');
  if(!name?.trim())return;
  const safeName=name.trim().slice(0,32);
  if(MOTIONS.some(m=>m.name.toLowerCase()===safeName.toLowerCase()) || state.customMotions.some(m=>m.name.toLowerCase()===safeName.toLowerCase())) {
    toast('That motion name is already in use. Choose another name.','error');return;
  }
  state.customMotions.push({name:safeName,duration:1.5,loop:false,category:'gesture',frames:structuredClone(state.draftFrames)});
  state.draftFrames=[];
  renderCustomMotionCards();
  selectMotion(safeName);
  toast(`Custom motion “${safeName}” saved in this project.`);
}

function syncMotionUI() {
  const duration=getDuration(state.baseMotion);
  const custom=getCustomMotion(state.baseMotion);
  const category=custom?'CUSTOM':getMotion(state.baseMotion).category.toUpperCase();
  $('#baseMotionLabel').textContent=`${state.baseMotion} · ${category.toLowerCase()}`;
  $('#sourceClipCaption').textContent=`${state.baseMotion} · ${category.toLowerCase()}`;
  $('#resultClipCaption').textContent=state.overlayMotion?`${state.baseMotion} + ${state.overlayMotion}`:`${state.baseMotion} · no overlay`;
  $('#overlayMotionLabel').textContent=state.overlayMotion?`${state.overlayMotion} · ${state.overlayMask}`:'No overlay selected';
  $('#durationTime').textContent=formatTime(duration);
  $('#overlaySelect').value=state.overlayMotion;
  $('#maskSelect').value=state.overlayMask;
  $('#blendRange').value=Math.round(state.blendWeight*100);
  $('#blendOut').textContent=`${Math.round(state.blendWeight*100)}%`;
  $$('.motion-card').forEach(card=>card.classList.toggle('active',card.dataset.motion===state.baseMotion));
}

function applyMotionPreview() {
  if(!sourceAvatar||!resultAvatar)return;
  updateAvatarPose(sourceAvatar,evaluateBasePose(state.progress));
  updateAvatarPose(resultAvatar,evaluateResultPose(state.progress));
  $('#resultClipCaption').textContent=state.overlayMotion?`${state.baseMotion} + ${state.overlayMotion}`:`${state.baseMotion} · no overlay`;
}

function formatTime(seconds) {
  const whole=Math.max(0,seconds);
  const minutes=Math.floor(whole/60);
  const secs=(whole-minutes*60).toFixed(2).padStart(5,'0');
  return `${String(minutes).padStart(2,'0')}:${secs}`;
}

function setProgressUI() {
  $('#timelineRange').value=Math.round(state.progress*1000);
  $('#currentTime').textContent=formatTime(state.progress*getDuration(state.baseMotion));
  $('#durationTime').textContent=formatTime(getDuration(state.baseMotion));
}

function updatePlayButton() {
  $('#playMotion').textContent=state.playing?'Ⅱ':'▶';
  $('#playMotion').setAttribute('aria-label',state.playing?'Pause motion':'Play motion');
}

function initTopActions() {
  $('#saveProject').addEventListener('click',()=>saveCurrentProject());
  $('#exportTop').addEventListener('click',()=>downloadAnimatedGLB());
  $('#downloadGlb').addEventListener('click',()=>downloadAnimatedGLB());
  $('#downloadProject').addEventListener('click',()=>downloadProjectFile());
  $('#openProjectInput').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try { const project=JSON.parse(await file.text()); await restoreProject(project); toast(`Opened project ${project.projectName||''}.`); }
    catch(error){toast(`Could not open project: ${error.message}`,'error');}
    event.target.value='';
  });
  $('#projectName').addEventListener('input',()=>{
    state.projectName=$('#projectName').value.trim()||'Untitled character';
    $('#exportCharacterName').textContent=state.projectName;
  });
}

function buildProjectData() {
  state.projectName=$('#projectName').value.trim()||'Untitled character';
  return {
    format:'forma-project',version:1,projectName:state.projectName,
    savedAt:new Date().toISOString(),shape:{...state.shape},
    references:structuredClone(state.references),
    referenceSlots:structuredClone(state.referenceSlots),
    customMotions:structuredClone(state.customMotions),
    baseMotion:state.baseMotion,overlayMotion:state.overlayMotion,overlayMask:state.overlayMask,blendWeight:state.blendWeight,
  };
}

async function saveCurrentProject() {
  try {
    const project=buildProjectData();
    await saveLocalProject(project);
    toast('Project saved in this browser. Use “Project file” to make a portable backup.');
  } catch(error) {
    toast(`Local save failed: ${error.message}`,'error',6000);
  }
}

function downloadProjectFile() {
  const project=buildProjectData();
  const base=project.projectName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'forma-character';
  downloadJSON(project,`${base}.forma`,'application/json');
}

async function restoreProject(project) {
  if(!project || (project.format!=='forma-project' && !project.shape))throw new Error('This is not a Forma Studio project file.');
  state.projectName=project.projectName||'Untitled character';
  $('#projectName').value=state.projectName;
  state.shape={...DEFAULT_SHAPE,...project.shape};
  state.references=Array.isArray(project.references)?project.references:[];
  state.referenceSlots=Array.isArray(project.referenceSlots)?project.referenceSlots:[
    {role:'front',label:'Front',required:true},{role:'side',label:'Side',required:true},{role:'back',label:'Back',required:false},{role:'threeQuarter',label:'3/4 view',required:false},
  ];
  state.customMotions=Array.isArray(project.customMotions)?project.customMotions:[];
  state.baseMotion=project.baseMotion||'Idle';state.overlayMotion=project.overlayMotion||'';state.overlayMask=project.overlayMask||'arms';state.blendWeight=Number(project.blendWeight??.65);
  state.meshMode='fitted';state.importedRoot=null;state.importedAnimations=[];state.importedPointCloud=false;
  setShapeUI(state.shape);renderReferenceGrid();renderCustomMotionCards();syncMotionUI();updateSourceChoice();
  createAllAvatars();
  $('#exportCharacterName').textContent=state.projectName;
  setProgressUI();
  navigate('build');
}

async function loadSavedProject() {
  try {
    const project=await loadLocalProject();
    if(project) { await restoreProject(project); toast('Restored the last locally saved project.','info'); }
  } catch(error) { console.info('No local project restored:',error.message); }
}

function initExport() {
  // The top-level export action and the dedicated export page use the same validated path.
}

function getExportTarget() {
  if(state.meshMode==='imported' && state.importedRoot) return state.importedRoot;
  return buildAvatar.root;
}

function downloadAnimatedGLB() {
  if(state.exporting)return;
  if(state.meshMode==='imported' && state.importedPointCloud){toast('This PLY contains points but no surface faces. Convert it to a mesh in Blender/MeshLab before GLB export.','error',6500);return;}
  const target=getExportTarget();
  if(!target){toast('There is no model available to export.','error');return;}
  state.exporting=true;
  toast('Preparing GLB: baking motion clips at 30 fps…','info',5000);
  const exporter=new GLTFExporter();
  const helper=state.meshMode==='imported'?null:buildAvatar.helper;
  if(helper)target.remove(helper);
  const animations=state.meshMode==='imported'?state.importedAnimations:createBakedClips(buildAvatar,state.customMotions,{
    baseName:state.baseMotion,overlayName:state.overlayMotion,mask:state.overlayMask,weight:state.blendWeight,
  });
  try {
    exporter.parse(target,result=>{
      if(helper)target.add(helper);
      state.exporting=false;
      if(!(result instanceof ArrayBuffer)){toast('The GLB exporter returned an unexpected result.','error');return;}
      const filename=(state.projectName||'forma-character').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'forma-character';
      downloadBlob(new Blob([result],{type:'model/gltf-binary'}),`${filename}.glb`);
      toast(`GLB exported. ${animations.length} animation clip(s) included.`);
    },error=>{
      if(helper)target.add(helper);
      state.exporting=false;
      console.error('GLB export error',error);
      toast(`GLB export failed: ${error.message||error}`,'error',6500);
    },{binary:true,animations,onlyVisible:true,trs:true,embedImages:true});
  } catch(error) {
    if(helper)target.add(helper);
    state.exporting=false;
    console.error(error);
    toast(`GLB export failed: ${error.message}`,'error',6500);
  }
}

function frame(now) {
  const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):0;
  lastFrame=now;
  if(state.playing) {
    const duration=getDuration(state.baseMotion);
    const isLoop=isMotionLoop(state.baseMotion);
    state.progress+=delta*state.speed/Math.max(.1,duration);
    if(isLoop) state.progress%=1;
    else if(state.progress>=1){state.progress=1;state.playing=false;updatePlayButton();}
    setProgressUI();
    applyMotionPreview();
  }
  if(buildAvatar && state.activePage==='build') {
    updateAvatarPose(buildAvatar,getMotionPose('Idle',now/3000));
  }
  if(exportAvatar && state.activePage==='export') {
    updateAvatarPose(exportAvatar,getMotionPose('Idle',now/3000));
  }
  const toRender={
    build:['build'],rig:['rig'],animate:['source','result'],export:['export'],help:[],
  }[state.activePage]||[];
  toRender.forEach(key=>renderView(views[key]));
  requestAnimationFrame(frame);
}

function checkRuntimeSupport() {
  if (!('WebGLRenderingContext' in window) && !('WebGL2RenderingContext' in window)) {
    const loading=$('#viewportLoading');
    loading.innerHTML='<strong>WebGL is disabled</strong><span>Enable hardware acceleration or open this page in a browser with WebGL support.</span>';
  }
}

async function init() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(error=>console.info('Offline cache unavailable:',error));
  checkRuntimeSupport();
  initNavigation();
  initShapeControls();
  initRigControls();
  initReferences();
  initMeshImport();
  initCameraControls();
  initMotionUI();
  initTopActions();
  initExport();
  state.projectName=$('#projectName').value;
  createViews();
  setShapeUI(state.shape);
  updateSourceChoice();
  renderCustomMotionCards();
  syncMotionUI();
  selectBone('Hips');
  setProgressUI();
  await loadSavedProject();
  requestAnimationFrame(frame);
}

init().catch(error=>{
  console.error('Forma Studio startup failed',error);
  toast(`Startup problem: ${error.message}`,'error',8000);
  window.dispatchEvent(new CustomEvent('forma:startup-error',{detail:{message:error?.message||String(error)}}));
});
