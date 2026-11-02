let raiNotificationReady = false;

async function initRAINotification() {
    if (!("Notification" in window)) {
        console.log("RAI NOTIFICATION: unsupported");
        return;
    }

    if (Notification.permission === "default") {
        console.log("RAI NOTIFICATION: permission belum diminta");
    } else {
        raiNotificationReady =
            Notification.permission === "granted";

        console.log(
            "RAI NOTIFICATION:",
            Notification.permission
        );
    }

    if ("serviceWorker" in navigator) {
        try {
            await navigator.serviceWorker.register(
                "/service-worker.js"
            );

            console.log(
                "RAI SERVICE WORKER: ONLINE"
            );
        } catch (e) {
            console.error(
                "RAI SERVICE WORKER ERROR:",
                e
            );
        }
    }
}

window.requestRAINotificationPermission =
    async function () {
        if (!("Notification" in window)) {
            return false;
        }

        try {
            const permission =
                await Notification.requestPermission();

            raiNotificationReady =
                permission === "granted";

            console.log(
                "RAI NOTIFICATION PERMISSION:",
                permission
            );

            return raiNotificationReady;
        } catch (e) {
            console.error(
                "RAI NOTIFICATION REQUEST ERROR:",
                e
            );

            return false;
        }
    };

async function notifyRAIFinished() {
    console.log(
        "RAI NOTIFICATION: notifyRAIFinished() DIPANGGIL"
    );

    // Notifikasi native Android saat berjalan di APK RAI.
    if (window.RAINative && typeof window.RAINative.responseFinished === "function") {
        try {
            window.RAINative.responseFinished();
        } catch (e) {
            console.error("RAI ANDROID NOTIFICATION ERROR:", e);
        }
    }

    if (!raiNotificationReady) {
        console.log(
            "RAI NOTIFICATION: permission belum granted"
        );
        return;
    }

    if (!document.hidden) {
        console.log(
            "RAI NOTIFICATION: user masih di halaman"
        );
        return;
    }

    try {
        const registration =
            await navigator.serviceWorker.ready;

        await registration.showNotification(
            "RAI — Jawaban selesai",
            {
                body:
                    "RAI sudah selesai menjawab pesan kamu.",
                icon: "/rai-logo.png",
                badge: "/rai-logo.png",
                tag: "rai-response",
                renotify: true
            }
        );

        console.log(
            "RAI NOTIFICATION: SENT"
        );
    } catch (e) {
        console.error(
            "RAI NOTIFICATION ERROR:",
            e
        );
    }
}

function playRAIFinishAnimation() {
    document.body.classList.remove(
        "rai-response-finished"
    );

    void document.body.offsetWidth;

    document.body.classList.add(
        "rai-response-finished"
    );

    setTimeout(() => {
        document.body.classList.remove(
            "rai-response-finished"
        );
    }, 900);
}

window.initRAINotification =
    initRAINotification;

window.notifyRAIFinished =
    notifyRAIFinished;

window.playRAIFinishAnimation =
    playRAIFinishAnimation;

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initRAINotification,
        { once: true }
    );
} else {
    initRAINotification();
}
