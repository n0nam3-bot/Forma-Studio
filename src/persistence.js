const DB_NAME = 'forma-studio-local';
const DB_VERSION = 1;
const STORE = 'projects';

function openDatabase() {
  return new Promise((resolve,reject)=>{
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable in this browser.'));
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error || new Error('Could not open local project storage.'));
  });
}

export async function saveLocalProject(project) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({id:'current',updatedAt:new Date().toISOString(),project});
    tx.oncomplete=()=>{db.close();resolve(true);};
    tx.onerror=()=>{db.close();reject(tx.error || new Error('Local save failed.'));};
    tx.onabort=()=>{db.close();reject(tx.error || new Error('Local save was interrupted.'));};
  });
}

export async function loadLocalProject() {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const request=tx.objectStore(STORE).get('current');
    request.onsuccess=()=>resolve(request.result?.project || null);
    request.onerror=()=>reject(request.error || new Error('Could not read local project.'));
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>{db.close();reject(tx.error || new Error('Could not read local project.'));};
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(reader.error || new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

export function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export function downloadJSON(data, filename, mime='application/json') {
  downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:mime}),filename);
}
