const DB_NAME = 'lord-phones-pos-offline';
const DB_VERSION = 2;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = ()=>{
      const db = req.result;

      if(!db.objectStoreNames.contains('cache')){
        db.createObjectStore('cache');
      }

      if(!db.objectStoreNames.contains('queue')){
        db.createObjectStore('queue', {keyPath:'id'});
      }
    };

    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

export async function putCache(key, value){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('cache','readwrite');

      tx.objectStore('cache').put(value,key);

      tx.oncomplete = ()=>resolve(true);
      tx.onerror = ()=>reject(tx.error);
    });
  }catch{
    return false;
  }
}

export async function getCache(key, fallback=null){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('cache','readonly');
      const request = tx.objectStore('cache').get(key);

      request.onsuccess = ()=>{
        resolve(request.result ?? fallback);
      };

      request.onerror = ()=>reject(request.error);
    });
  }catch{
    return fallback;
  }
}

export async function deleteCache(key){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('cache','readwrite');

      tx.objectStore('cache').delete(key);

      tx.oncomplete = ()=>resolve(true);
      tx.onerror = ()=>reject(tx.error);
    });
  }catch{
    return false;
  }
}

export async function queueOperation(operation){
  try{
    const db = await openDB();

    const item = {
      ...operation,
      id: operation.id || crypto.randomUUID(),
      created_at: operation.created_at || new Date().toISOString(),
      attempts: Number(operation.attempts || 0),
      last_attempt_at: operation.last_attempt_at || null
    };

    await new Promise((resolve,reject)=>{
      const tx = db.transaction('queue','readwrite');

      tx.objectStore('queue').put(item);

      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });

    return item;
  }catch{
    return null;
  }
}

export async function queueSaleAndApplyInventory(payload){
  try{
    const db = await openDB();

    const item = {
      type:"sale",
      payload,
      id:crypto.randomUUID(),
      created_at:new Date().toISOString(),
      attempts:0,
      last_attempt_at:null
    };

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(["queue","cache"],"readwrite");
      const queueStore = tx.objectStore("queue");
      const cacheStore = tx.objectStore("cache");

      const productsRequest = cacheStore.get("products");
      const phonesRequest = cacheStore.get("phones");

      let products = [];
      let phones = [];

      productsRequest.onsuccess = ()=>{
        products = productsRequest.result || [];
      };

      phonesRequest.onsuccess = ()=>{
        phones = phonesRequest.result || [];
      };

      tx.oncomplete = ()=>resolve(item);

      tx.onerror = ()=>reject(tx.error || new Error("Could not save offline sale."));

      tx.onabort = ()=>reject(tx.error || new Error("Offline sale transaction was aborted."));

      Promise.resolve().then(()=>{
        return new Promise((resolveRequests,rejectRequests)=>{
          let productsReady=false;
          let phonesReady=false;

          const continueTransaction=()=>{
            if(!productsReady || !phonesReady) return;

            const updatedProducts = products.map(product=>({...product}));
            const updatedPhones = phones.map(phone=>({...phone}));

            for(const saleItem of payload.p_items || []){
              if(saleItem.product_id){
                const product = updatedProducts.find(
                  p=>String(p.id)===String(saleItem.product_id)
                );

                if(!product){
                  rejectRequests(new Error(`Product ${saleItem.product_id} is not available in offline inventory.`));
                  return;
                }

                const quantity = Number(saleItem.quantity || 0);
                const currentStock = Number(product.stock || 0);

                if(quantity <= 0 || currentStock < quantity){
                  rejectRequests(new Error(`Insufficient offline stock for ${product.name || "this product"}.`));
                  return;
                }

                product.stock = currentStock - quantity;
              }

              if(saleItem.imei){
                const phone = updatedPhones.find(
                  p=>String(p.imei_1 || "")===String(saleItem.imei) ||
                     String(p.imei_2 || "")===String(saleItem.imei)
                );

                if(!phone){
                  rejectRequests(new Error(`Phone with IMEI ${saleItem.imei} is not available in offline inventory.`));
                  return;
                }

                if(String(phone.status) !== "In Stock"){
                  rejectRequests(new Error(`Phone with IMEI ${saleItem.imei} is no longer available.`));
                  return;
                }

                phone.status = "Sold";
              }
            }

            queueStore.put(item);
            cacheStore.put(updatedProducts,"products");
            cacheStore.put(updatedPhones,"phones");

            resolveRequests();
          };

          productsRequest.onsuccess=()=>{
            productsReady=true;
            continueTransaction();
          };

          phonesRequest.onsuccess=()=>{
            phonesReady=true;
            continueTransaction();
          };

          productsRequest.onerror=()=>rejectRequests(productsRequest.error);
          phonesRequest.onerror=()=>rejectRequests(phonesRequest.error);
        });
      }).catch(error=>{
        try{ tx.abort(); }catch{}
        reject(error);
      });
    });
  }catch{
    return null;
  }
}
export async function getQueue(){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('queue','readonly');
      const request = tx.objectStore('queue').getAll();

      request.onsuccess = ()=>{
        const queue = request.result || [];

        queue.sort((a,b)=>{
          return String(a.created_at || '').localeCompare(
            String(b.created_at || '')
          );
        });

        resolve(queue);
      };

      request.onerror = ()=>reject(request.error);
    });
  }catch{
    return [];
  }
}

export async function updateQueued(id, changes){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('queue','readwrite');
      const store = tx.objectStore('queue');
      const request = store.get(id);

      request.onsuccess = ()=>{
        if(!request.result){
          resolve(false);
          return;
        }

        store.put({
          ...request.result,
          ...changes,
          id
        });
      };

      request.onerror = ()=>reject(request.error);
      tx.oncomplete = ()=>resolve(true);
      tx.onerror = ()=>reject(tx.error);
    });
  }catch{
    return false;
  }
}

export async function removeQueued(id){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('queue','readwrite');

      tx.objectStore('queue').delete(id);

      tx.oncomplete = ()=>resolve(true);
      tx.onerror = ()=>reject(tx.error);
    });
  }catch{
    return false;
  }
}

export async function clearQueue(){
  try{
    const db = await openDB();

    return await new Promise((resolve,reject)=>{
      const tx = db.transaction('queue','readwrite');

      tx.objectStore('queue').clear();

      tx.oncomplete = ()=>resolve(true);
      tx.onerror = ()=>reject(tx.error);
    });
  }catch{
    return false;
  }
}

export function registerOfflineServiceWorker(){
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker
        .register('/sw.js')
        .catch(()=>{});
    });
  }
}


