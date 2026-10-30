self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        self.clients.claim()
    );
});

self.addEventListener("message", event => {
    if (
        !event.data ||
        event.data.type !==
        "RAI_RESPONSE_COMPLETE"
    ) {
        return;
    }

    event.waitUntil(
        self.registration.showNotification(
            "RAI — Jawaban selesai",
            {
                body:
                    "RAI sudah selesai menjawab pesan kamu.",
                tag: "rai-response",
                renotify: true
            }
        )
    );
});

self.addEventListener(
    "notificationclick",
    event => {
        event.notification.close();

        event.waitUntil(
            clients.matchAll({
                type: "window",
                includeUncontrolled: true
            }).then(clientList => {

                for (const client of clientList) {
                    if ("focus" in client) {
                        return client.focus();
                    }
                }

                if (clients.openWindow) {
                    return clients.openWindow("/");
                }
            })
        );
    }
);
