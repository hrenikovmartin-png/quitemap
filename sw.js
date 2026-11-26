const CACHE_PREFIX='quietwalk-shell-';
const CACHE_NAME=CACHE_PREFIX+'v2';
const BASE=self.registration.scope;
const SHELL=[
  new URL('index.html',BASE).href,
  new URL('krasnodar-krai.geojson.gz.b64',BASE).href,
  new URL('manifest.webmanifest',BASE).href,
  new URL('quietwalk.svg',BASE).href
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async url=>{
      try{
        const response=await fetch(url,{cache:'reload'});
        if(response.ok||response.type==='opaque')await cache.put(url,response);
      }catch(error){console.warn('QuietWalk precache skipped:',url,error)}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  const sameOrigin=url.origin===self.location.origin;
  // Third-party libraries must use the browser's live network path. Caching
  // CDN responses here can pin a stale/broken Leaflet build and hide fallback errors.
  if(!sameOrigin)return;
  if(sameOrigin&&request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(new URL('index.html',BASE).href,response.clone())}
        return response;
      }catch(error){
        const cached=await caches.match(new URL('index.html',BASE).href);
        if(cached)return cached;
        return new Response('QuietWalk is offline. Open the app once while connected to prepare the offline shell.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok||response.type==='opaque'){
        const cache=await caches.open(CACHE_NAME);
        await cache.put(request,response.clone());
      }
      return response;
    }catch(error){
      return new Response('',{status:503,statusText:'Offline'});
    }
  })());
});
