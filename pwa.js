/* =========================================================
   MEDVAULT PWA CONTROLLER
   ========================================================= */

(function () {

  "use strict";

  console.log("📱 MedVault PWA starting...");


  /* -------------------------------------------------------
     SERVICE WORKER REGISTRATION
  ------------------------------------------------------- */

  if ("serviceWorker" in navigator) {

    window.addEventListener("load", async () => {

      try {

        const registration =
          await navigator.serviceWorker.register(
            "./sw.js",
            {
              scope: "./"
            }
          );

        console.log(
          "✅ MedVault Service Worker registered:",
          registration.scope
        );


        /*
         * Detect a new version.
         */

        registration.addEventListener(
          "updatefound",
          () => {

            const newWorker =
              registration.installing;

            if (!newWorker) {
              return;
            }

            newWorker.addEventListener(
              "statechange",
              () => {

                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {

                  console.log(
                    "🔄 New MedVault version available."
                  );

                  showUpdateMessage(
                    registration
                  );
                }

              }
            );

          }
        );

      } catch (error) {

        console.error(
          "❌ MedVault PWA registration failed:",
          error
        );

      }

    });

  } else {

    console.warn(
      "⚠️ Service Workers are not supported."
    );

  }


  /* -------------------------------------------------------
     INSTALL PROMPT
  ------------------------------------------------------- */

  let deferredPrompt = null;

  window.addEventListener(
    "beforeinstallprompt",
    event => {

      event.preventDefault();

      deferredPrompt = event;

      console.log(
        "📲 MedVault can be installed."
      );

      showInstallButton();

    }
  );


  window.addEventListener(
    "appinstalled",
    () => {

      console.log(
        "✅ MedVault installed successfully."
      );

      deferredPrompt = null;

      hideInstallButton();

    }
  );


  /* -------------------------------------------------------
     INSTALL BUTTON
  ------------------------------------------------------- */

  function showInstallButton() {

    let button =
      document.getElementById(
        "medvaultInstallBtn"
      );

    if (!button) {

      button = document.createElement("button");

      button.id =
        "medvaultInstallBtn";

      button.type =
        "button";

      button.className =
        "medvault-install-btn";

      button.innerHTML = `
        <span>📱</span>
        <span>Install MedVault</span>
      `;

      button.addEventListener(
        "click",
        installMedVault
      );

      document.body.appendChild(button);
    }

    button.classList.add("visible");
  }


  async function installMedVault() {

    if (!deferredPrompt) {

      console.log(
        "ℹ️ Installation prompt is not available."
      );

      return;
    }

    deferredPrompt.prompt();

    const result =
      await deferredPrompt.userChoice;

    console.log(
      "PWA installation result:",
      result.outcome
    );

    deferredPrompt = null;

    hideInstallButton();
  }


  function hideInstallButton() {

    const button =
      document.getElementById(
        "medvaultInstallBtn"
      );

    if (button) {
      button.classList.remove("visible");
    }

  }


  /* -------------------------------------------------------
     UPDATE MESSAGE
  ------------------------------------------------------- */

  function showUpdateMessage(registration) {

    const existing =
      document.getElementById(
        "medvaultUpdateBanner"
      );

    if (existing) {
      return;
    }

    const banner =
      document.createElement("div");

    banner.id =
      "medvaultUpdateBanner";

    banner.className =
      "medvault-update-banner";

    banner.innerHTML = `
      <div>
        <strong>MedVault updated</strong>
        <span>A new version is ready.</span>
      </div>

      <button type="button" id="medvaultUpdateBtn">
        Update
      </button>
    `;

    document.body.appendChild(banner);

    document
      .getElementById("medvaultUpdateBtn")
      .addEventListener(
        "click",
        () => {

          const worker =
            registration.waiting;

          if (worker) {

            worker.postMessage({
              type: "SKIP_WAITING"
            });

          }

          window.location.reload();

        }
      );

  }


  /* -------------------------------------------------------
     ONLINE / OFFLINE STATUS
  ------------------------------------------------------- */

  function updateNetworkStatus() {

    document.documentElement
      .classList.toggle(
        "medvault-offline",
        !navigator.onLine
      );

    console.log(
      navigator.onLine
        ? "🟢 MedVault online"
        : "🔴 MedVault offline"
    );
  }

  window.addEventListener(
    "online",
    updateNetworkStatus
  );

  window.addEventListener(
    "offline",
    updateNetworkStatus
  );

  updateNetworkStatus();


  /* -------------------------------------------------------
     HANDLE PWA SHORTCUTS
  ------------------------------------------------------- */

  function handleShortcut() {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const section =
      params.get("section");

    if (!section) {
      return;
    }

    /*
     * Wait until your MedVault application
     * has loaded its navigation functions.
     */

    setTimeout(() => {

      if (
        typeof window.openSection ===
        "function"
      ) {

        window.openSection(section);

      }

    }, 700);

  }


  window.addEventListener(
    "load",
    handleShortcut
  );


})();