/* =========================================================
   MEDVAULT PWA SERVICE WORKER
   ========================================================= */

const CACHE_NAME = "medvault-shell-v8";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./pwa.js",
  "./search.js",
  "./data.json",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* ---------------------------------------------------------
   INSTALL
--------------------------------------------------------- */

self.addEventListener("install", event => {
  console.log("[MedVault SW] Installing...");

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log("[MedVault SW] App shell cached.");
        return self.skipWaiting();
      })
      .catch(error => {
        console.error(
          "[MedVault SW] Failed to cache app shell:",
          error
        );
      })
  );
});


/* ---------------------------------------------------------
   ACTIVATE
--------------------------------------------------------- */

self.addEventListener("activate", event => {
  console.log("[MedVault SW] Activating...");

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log(
                "[MedVault SW] Removing old cache:",
                name
              );

              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});


/* ---------------------------------------------------------
   FETCH
--------------------------------------------------------- */

self.addEventListener("fetch", event => {

  const request = event.request;

  /* Only handle GET requests */
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * NEVER cache Supabase API/database/storage requests.
   *
   * Medical records are sensitive information.
   */
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/rest/") ||
    url.pathname.includes("/storage/")
  ) {
    return;
  }


  /*
   * Navigation requests:
   *
   * Try network first.
   * If offline, return cached index.html.
   */

  if (request.mode === "navigate") {

    event.respondWith(
      fetch(request)
        .then(response => {

          /*
           * Keep the latest application shell available.
           */
          if (response.ok) {

            const responseClone = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                // Store using both request and URL fallback to ensure offline cache matches regardless of URL resolution
                cache.put(request, responseClone);
                cache.put("./index.html", responseClone.clone());
              });
          }

          return response;
        })
        .catch(() => {

          return caches.match("./index.html")
            .then(res => res || caches.match("./"));
        })
    );

    return;
  }


  /*
   * Static assets:
   *
   * Cache first.
   * Network fallback.
   */

  event.respondWith(

    caches.match(request)
      .then(cachedResponse => {

        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then(response => {

            /*
             * Only cache successful same-origin assets.
             */

            if (
              response.ok &&
              url.origin === self.location.origin
            ) {

              const responseClone = response.clone();

              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, responseClone);
                });
            }

            return response;
          });
      })
      .catch(() => {

        /*
         * Asset unavailable while offline.
         */

        return caches.match("./index.html")
          .then(fallback => fallback || new Response(
            "MedVault is currently offline.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain"
              }
            }
          ));
      })
  );
});


/* ---------------------------------------------------------
   NOTIFICATIONS
--------------------------------------------------------- */

/* Handle Background Medicine Alarms & Notifications */
self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        /* Focus existing tab if open */
        for (let client of clientList) {
          if (client.url && "focus" in client) {
            return client.focus();
          }
        }
        /* Open new tab if app is closed */
        if (clients.openWindow) {
          return clients.openWindow("./");
        }
      })
  );
});


/* ---------------------------------------------------------
   MESSAGE HANDLER
--------------------------------------------------------- */

self.addEventListener("message", event => {

  if (!event.data) {
    return;
  }

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

});
