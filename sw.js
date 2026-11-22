const CACHE_NAME = 'forma-studio-shell-v2';
const APP_FILES = ['./','./index.html','./bootstrap.js','./styles.css','./src/main.js','./src/model.js','./src/motion.js','./src/persistence.js'];
const THREE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/three@0.180.0/',
  'https://unpkg.com/three@0.180.0/',
  'https://fastly.jsdelivr.net/npm/three@0.180.0/',
  'https://gcore.jsdelivr.net/npm/three@0.180.0/',
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  const sameOrigin=url.origin===self.location.origin;
  const threeCdn=THREE_PREFIXES.some(prefix=>url.href.startsWith(prefix));
  if(!sameOrigin&&!threeCdn)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response && (response.ok||response.type==='opaque'))cache.put(request,response.clone()).catch(()=>{});
      return response;
    }catch(error){
      if(cached)return cached;
      throw error;
    }
  })());
});
