require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { execFile, spawn } = require("child_process");
const Groq = require("groq-sdk");
const OpenAI = require("openai");
const {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Packer
} = require("docx");

const PptxGenJS = require("pptxgenjs");
const PDFDocument = require("pdfkit");

const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const { setupAuth } = require("./auth");

app.set("trust proxy", 1);
const { requireLogin } = setupAuth(app);

const exifr = require("exifr");
const multer = require("multer");

const trackImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024
    }
});
if (!process.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY tidak ditemukan.");
    process.exit(1);
}

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const geminiChat = process.env.GEMINI_API_KEY
    ? new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    })
    : null;

const geminiImage = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    })
    : null;

app.use(express.json({ limit: "30mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ========================================
// RAI ENGINE VERSION / UPDATE CHECK
// ========================================

const RAI_ENGINE_VERSION = "2.4.3";

app.get("/api/engine-update", async (req, res) => {
    try {
        const manifestUrl =
            "https://raw.githubusercontent.com/mbudiarumprasetiyo-hub/rai/main/rai-engine.json";

        const response = await fetch(manifestUrl, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "RAI-Engine-Updater"
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            return res.status(503).json({
                success: false,
                error: "RAI update manifest belum tersedia di GitHub."
            });
        }

        const manifest = await response.json();

        if (
            typeof manifest.version !== "string" ||
            !/^\d+\.\d+\.\d+$/.test(manifest.version)
        ) {
            return res.status(502).json({
                success: false,
                error: "Manifest versi RAI tidak valid."
            });
        }

        res.setHeader("Cache-Control", "no-store");

        res.json({
            success: true,
            currentVersion: RAI_ENGINE_VERSION,
            latestVersion: manifest.version,
            changelog: manifest.changelog || "",
            releaseUrl: manifest.release_url || ""
        });

    } catch (error) {
        console.error("RAI ENGINE UPDATE CHECK:", error.message);

        res.status(503).json({
            success: false,
            error: "Gagal terhubung ke server update RAI."
        });
    }
});



// ========================================
// RAI ENGINE LOCAL INSTALLER
// ========================================

let raiUpdateRunning = false;

app.post("/api/engine-update/install", (req, res) => {
    const remoteAddress = req.socket.remoteAddress || "";

    const isLoopback = [
        "127.0.0.1",
        "::1",
        "::ffff:127.0.0.1"
    ].includes(remoteAddress);

    const origin = req.get("origin");

    const allowedOrigins = [
        `http://localhost:${PORT}`,
        `http://127.0.0.1:${PORT}`
    ];

    if (!isLoopback || !allowedOrigins.includes(origin)) {
        return res.status(403).json({
            success: false,
            error: "Akses installer hanya diizinkan dari browser lokal RAI."
        });
    }

    if (raiUpdateRunning) {
        return res.status(409).json({
            success: false,
            error: "Updater RAI sedang berjalan."
        });
    }

    raiUpdateRunning = true;

    const updaterPath = path.join(__dirname, "rai-updater.sh");

    execFile(
        updaterPath,
        [],
        {
            cwd: __dirname,
            env: {
                ...process.env,
                RAI_UPDATE_AUTO: "1"
            },
            maxBuffer: 4 * 1024 * 1024
        },
        (error, stdout, stderr) => {
            raiUpdateRunning = false;

            const output = [stdout, stderr]
                .filter(Boolean)
                .join("\n")
                .slice(-12000);

            if (error) {
                console.error("RAI ENGINE INSTALL FAILED:", error.message);

                return res.status(500).json({
                    success: false,
                    error: error.message,
                    output
                });
            }

            console.log("RAI ENGINE INSTALL:", output);

            const installedVersionMatch = output.match(
                /Update RAI (\d+\.\d+\.\d+) berhasil dipasang/i
            );

            if (!installedVersionMatch) {
                return res.status(500).json({
                    success: false,
                    error: "Update selesai, tetapi versi terpasang tidak dapat diverifikasi.",
                    output
                });
            }

            const installedVersion = installedVersionMatch[1];

            res.json({
                success: true,
                output,
                installedVersion,
                restartScheduled: true
            });

            // Jalankan server baru secara terpisah.
            // Server lama dihentikan setelah respons terkirim.
            setTimeout(() => {
                try {
                    const restartProcess = spawn(
                        "bash",
                        [
                            "-c",
                            'sleep 2; cd "$RAI_APP_DIR" || exit 1; exec npm start >> "$RAI_LOG_FILE" 2>&1'
                        ],
                        {
                            cwd: __dirname,
                            detached: true,
                            stdio: "ignore",
                            env: {
                                ...process.env,
                                RAI_APP_DIR: __dirname,
                                RAI_LOG_FILE: path.join(__dirname, "rai-server.log")
                            }
                        }
                    );

                    restartProcess.once("error", (restartError) => {
                        console.error(
                            "RAI AUTO RESTART ERROR:",
                            restartError
                        );
                    });

                    restartProcess.unref();

                    console.log(
                        "RAI AUTO RESTART SCHEDULED:",
                        installedVersion
                    );

                    setTimeout(() => process.exit(0), 500);

                } catch (restartError) {
                    console.error(
                        "RAI AUTO RESTART FAILED:",
                        restartError
                    );
                }
            }, 300);
        }
    );
});


app.post("/api/generate-image", requireLogin, async (req, res) => {

    try {

        const accountId =
            process.env.CLOUDFLARE_ACCOUNT_ID;

        const apiToken =
            process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !apiToken) {
            return res.status(500).json({
                error:
                    "CLOUDFLARE_ACCOUNT_ID atau CLOUDFLARE_API_TOKEN belum tersedia."
            });
        }

        const prompt =
            typeof req.body.prompt === "string"
                ? req.body.prompt.trim()
                : "";

        if (!prompt) {
            return res.status(400).json({
                error: "Prompt gambar kosong."
            });
        }

        console.log(
            "RAI IMAGE GENERATION:",
            prompt
        );

        const form =
            new FormData();

        form.append(
            "prompt",
            prompt
        );

        form.append(
            "width",
            "768"
        );

        form.append(
            "height",
            "768"
        );

        const response =
            await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
                {
                    method: "POST",

                    headers: {
                        Authorization:
                            `Bearer ${apiToken}`
                    },

                    body: form
                }
            );

        const responseText =
            await response.text();

        let data;

        try {
            data =
                JSON.parse(responseText);
        } catch {
            console.error(
                "RAI IMAGE INVALID RESPONSE:",
                responseText.slice(0, 500)
            );

            return res.status(502).json({
                error:
                    "Cloudflare mengembalikan response yang tidak valid."
            });
        }

        if (
            !response.ok ||
            !data.success ||
            !data.result?.image
        ) {

            console.error(
                "RAI IMAGE CLOUDFLARE ERROR:",
                response.status,
                data
            );

            const cloudflareError =
                data?.errors?.[0];

            if (
                cloudflareError?.code === 3030
            ) {
                return res.status(400).json({
                    error:
                        "Prompt gambar ditolak oleh sistem keamanan image generator. Coba ubah deskripsi gambarnya."
                });
            }

            return res.status(
                response.status || 502
            ).json({
                error:
                    cloudflareError?.message ||
                    data?.error ||
                    "Cloudflare gagal membuat gambar."
            });
        }

        const rawImage =
            data.result.image;

        const image =
            rawImage.startsWith("data:")
                ? rawImage
                : `data:image/jpeg;base64,${rawImage}`;

        console.log(
            "RAI IMAGE GENERATED:",
            image.length,
            "characters"
        );

        res.json({
            success: true,
            image
        });

    } catch (error) {

        console.error(
            "RAI IMAGE GENERATION ERROR:",
            error
        );

        if (
            error?.name ===
            "AbortError"
        ) {
            return res.status(499).json({
                error: "Pembuatan gambar dihentikan."
            });
        }

        res.status(500).json({
            error:
                error?.message ||
                "Gagal membuat gambar."
        });
    }
});

async function readRAILink(message) {
    if (typeof message !== "string") return null;

    const urlMatch = message.match(
        /https?:\/\/[^\s<>"']+/i
    );

    if (!urlMatch) return null;

    let urlText = urlMatch[0].replace(/[),.!?;:]+$/, "");

    let target;
    try {
        target = new URL(urlText);
    } catch {
        return {
            error: "URL yang dikirim tidak valid."
        };
    }

    if (!["http:", "https:"].includes(target.protocol)) {
        return {
            error: "RAI hanya dapat membaca link HTTP atau HTTPS."
        };
    }

    const hostname = target.hostname.toLowerCase();

    const blockedHosts = [
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0"
    ];

    if (
        blockedHosts.includes(hostname) ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local")
    ) {
        return {
            error: "Link tersebut tidak dapat dibaca oleh RAI."
        };
    }

    console.log("RAI LINK DETECTED:", target.href);

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        10000
    );

    try {
        const response = await fetch(target.href, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "RAI-Link-Reader/1.0"
            }
        });

        if (!response.ok) {
            return {
                error:
                    "Website tidak dapat dibaca. HTTP " +
                    response.status
            };
        }

        const contentType =
            response.headers.get("content-type") || "";

        if (
            !contentType.includes("text/html") &&
            !contentType.includes("text/plain")
        ) {
            return {
                error:
                    "Link tersebut bukan halaman web yang dapat dibaca RAI."
            };
        }

        const contentLength =
            Number(response.headers.get("content-length")) || 0;

        if (contentLength > 5 * 1024 * 1024) {
            return {
                error:
                    "Halaman terlalu besar untuk dibaca RAI."
            };
        }

        let html = await response.text();

        if (html.length > 5 * 1024 * 1024) {
            html = html.slice(0, 5 * 1024 * 1024);
        }

        const titleMatch =
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

        const title = titleMatch
            ? titleMatch[1]
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : "";

        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/\s+/g, " ")
            .trim();

        const MAX_LINK_TEXT = 50000;

        text = text.slice(0, MAX_LINK_TEXT);

        if (!text) {
            return {
                error:
                    "RAI tidak menemukan teks yang dapat dibaca dari halaman tersebut."
            };
        }

        console.log(
            "RAI LINK READ:",
            text.length,
            "characters"
        );

        return {
            url: target.href,
            title,
            text
        };

    } catch (error) {
        console.error(
            "RAI LINK ERROR:",
            error?.message || error
        );

        if (error?.name === "AbortError") {
            return {
                error:
                    "Waktu membaca link habis. Website terlalu lambat atau tidak merespons."
            };
        }

        return {
            error:
                "RAI tidak dapat membaca website tersebut."
        };

    } finally {
        clearTimeout(timeout);
    }
}

app.post("/api/chat", async (req, res) => {

    console.log("RAI API CHAT ENTERED");
    try {

        const message = req.body.message;
        const selectedEngine =
            ["rexa", "venum", "noxes"].includes(
                String(req.body.engine || "").toLowerCase()
            )
                ? String(req.body.engine || "").toLowerCase()
                : "rexa";

        // RAI MEMORY V2
        const raiMemory = Array.isArray(req.body.memory)
            ? req.body.memory
                .filter(item => typeof item === "string")
                .map(item => item.trim().slice(0, 300))
                .filter(Boolean)
                .slice(-40)
            : [];
        const image = req.body.image;
        const file = req.body.file;

        const personality =
            ["normal", "coding", "formal", "chill", "savage"].includes(req.body.personality)
                ? req.body.personality
                : "normal";

        const personalityInstructions = {
            normal: `
MODE PERSONALITY: NORMAL V2

Kamu adalah asisten AI yang natural, cerdas, komunikatif, dan objektif.
Gunakan bahasa Indonesia modern yang mudah dipahami.
Jangan terlalu kaku, jangan terlalu banyak basa-basi.
Berikan jawaban yang relevan, akurat, dan sesuai kebutuhan pengguna.
Jangan otomatis menyetujui pendapat pengguna.
Jika pengguna salah, koreksi dengan jelas dan jelaskan alasannya.
Sesuaikan panjang jawaban dengan tingkat kesulitan pertanyaan.
Untuk pertanyaan sederhana, jawab langsung.
Untuk pertanyaan kompleks, lakukan analisis dan berikan penjelasan terstruktur.
Hindari jawaban generik, repetitif, dan template yang terasa seperti robot.
`,

            chill: `
MODE PERSONALITY: CHILL V2 — SANTAI, ASIK, NATURAL

Kamu adalah RAI dengan karakter santai, asik, humoris, dan terasa seperti teman ngobrol yang nyambung.

GAYA BICARA:
- Gunakan bahasa Indonesia sehari-hari yang natural dan kekinian.
- Boleh menggunakan "cuy", "bro", "wkwk", "anjay", "jir", "nah", "lah", "gas", dan slang lain secara spontan.
- Jangan memakai slang secara berlebihan atau mengulang kata yang sama di setiap kalimat.
- Boleh bercanda, membuat celetukan spontan, dan menggunakan humor situasional.
- Respons harus terasa hidup, bukan seperti chatbot formal yang diberi slang.
- Ikuti energi percakapan pengguna tanpa menirunya secara berlebihan.
- Emoji boleh digunakan sesekali jika cocok.

INTERAKSI:
- Bisa ngobrol santai, membahas teknologi, coding, game, sekolah, dan topik sehari-hari.
- Jika pengguna melakukan kesalahan kecil, boleh menanggapi dengan candaan ringan.
- Jangan selalu membuka jawaban dengan sapaan atau slang.
- Jangan asal menyetujui pengguna; tetap jujur dan masuk akal.
- Jika pengguna membutuhkan penjelasan, jelaskan dengan bahasa sederhana dan santai.
- Saat topik serius, sensitif, atau penting, utamakan empati, ketepatan, dan bantuan nyata.
- Jangan memaksakan humor ketika situasi tidak cocok.

INTELLIGENCE:
- Gaya santai tidak berarti jawaban dangkal.
- Tetap mampu menjelaskan topik kompleks, melakukan analisis, dan menyelesaikan masalah.
- Jangan mengurangi detail penting hanya karena personality CHILL aktif.
`,

            formal: `
MODE PERSONALITY: FORMAL V2 — PROFESSIONAL

Gunakan bahasa Indonesia baku, profesional, sopan, dan terstruktur.
Utamakan kejelasan, ketepatan istilah, dan argumentasi yang logis.
Hindari slang, candaan berlebihan, dan ungkapan terlalu kasual.
Gunakan struktur yang rapi untuk laporan, tugas akademik, dokumentasi, dan analisis.
Jangan membuat jawaban terlalu kaku atau bertele-tele.
Jika pengguna meminta format tertentu, ikuti format tersebut.
Jika terdapat kesalahan dalam asumsi pengguna, koreksi secara profesional.
`,

            savage: `
MODE PERSONALITY: SAVAGE V2 — GEN Z ROAST MODE

Kamu adalah RAI dengan karakter ceplas-ceplos, savage, sarkastik, percaya diri, kritis, dan memiliki humor roasting khas internet Indonesia.

GAYA BICARA:
- Gunakan bahasa Indonesia kekinian, slang Gen Z, dan bahasa percakapan internet secara natural.
- Boleh memakai "cuy", "jir", "bro", "wkwk", "anjir", "lah", "ngaco", "cooked", "skill issue", dan istilah relevan lainnya.
- Roasting boleh tajam, kreatif, spontan, dan cukup intens jika konteksnya cocok.
- Jangan terdengar seperti kumpulan template roasting.
- Gunakan sarkasme, analogi lucu, hiperbola, dan celetukan yang relevan.
- Jangan memaksakan kata kasar atau slang pada setiap kalimat.
- Variasikan humor agar tidak monoton.

ROASTING:
- Boleh meledek kesalahan, ide absurd, kode berantakan, keputusan tidak masuk akal, atau situasi konyol.
- Roasting harus relevan dengan konteks, bukan hinaan acak.
- Boleh menyindir pengguna secara ringan hingga tajam dalam konteks bercanda yang jelas.
- Kritik tindakan, ide, dan hasil kerja; jangan menyerang identitas, kondisi fisik, atau hal sensitif pribadi.
- Jangan mengubah seluruh jawaban menjadi roasting. Tetap berikan solusi atau jawaban yang berguna.
- Jika pengguna meminta kritik, jangan menyembunyikan kelemahan atau berpura-pura semuanya bagus.
- Jangan asal setuju hanya untuk menyenangkan pengguna.

CONTOH NUANSA:
"Bro, ini bukan bug biasa. Logikanya lagi mengambil cuti tanpa izin 💀"
"Cuy, idenya bisa jalan, tapi implementasinya masih perlu diselamatkan."
"Jir, satu typo bisa bikin satu sistem ikut kena mental. Nih kita bedah."

CONTEXT AWARENESS:
- Jika pengguna sedang bercanda, balas dengan roasting yang selevel atau lebih kreatif.
- Jika pengguna meminta evaluasi, berikan kritik jujur dan tajam beserta solusi.
- Jika pengguna sedang serius, menghadapi masalah, atau membutuhkan bantuan penting, kurangi roasting dan prioritaskan bantuan.
- Jangan membuat roasting menghambat penjelasan teknis, tugas sekolah, atau solusi nyata.
- Savage bukan berarti asal kasar, bodoh, atau tidak akurat.
`,

            coding: `
MODE PERSONALITY: CODING V2 — ELITE DEVELOPER

Bertindak sebagai asisten programmer yang analitis, teliti, praktis, dan berorientasi solusi.
Prioritaskan debugging, arsitektur, keamanan, efisiensi, maintainability, dan akurasi teknis.
Identifikasi akar masalah, bukan hanya gejala.
Jika memberikan kode, pastikan kode konsisten dengan konteks dan siap diuji.
Jangan mengarang nama file, fungsi, variabel, API, atau konfigurasi yang belum diketahui.
Jika informasi kurang, minta bagian kode yang relevan sebelum membuat perubahan berisiko.
Berikan langkah implementasi yang jelas.
Untuk Termux dan Android, perhatikan kompatibilitas shell, Node.js, filesystem, dan keterbatasan perangkat.
Jelaskan lokasi perubahan, alasan, dan cara verifikasi.
Hindari basa-basi dan teori yang tidak diperlukan.
Untuk coding santai, boleh menggunakan humor ringan tanpa mengurangi ketelitian.
`
        };

        const selectedPersonality =
            personalityInstructions[personality];

        console.time("RAI SERVER TOTAL");

        console.log("RAI CHAT RECEIVED");
        console.log("MESSAGE:", message);
        console.log("PERSONALITY:", personality);
        console.log("IMAGE:", image ? "ADA (" + image.length + " chars)" : "TIDAK ADA");
        console.log("RAI DEBUG IMAGE TYPE:", typeof image);
        console.log("RAI DEBUG IMAGE TYPE:", typeof image);

        if (!message || !message.trim()) {
            return res.status(400).json({
                error: "Pesan kosong."
            });
        }

        const rawHistory = Array.isArray(req.body.history)
            ? req.body.history
                .filter(item =>
                    item &&
                    (item.role === "user" || item.role === "ai") &&
                    typeof item.content === "string" &&
                    item.content.trim()
                )
            : [];

        const history = [];

        const HISTORY_LIMIT = 8;
        const HISTORY_CHAR_BUDGET = 16000;

        let historyChars = 0;

        for (let i = rawHistory.length - 1; i >= 0; i--) {
            const item = rawHistory[i];

            const content =
                item.content
                    .trim()
                    .slice(0, 4000);

            if (!content) continue;

            if (
                history.length >= HISTORY_LIMIT ||
                historyChars + content.length > HISTORY_CHAR_BUDGET
            ) {
                break;
            }

            history.unshift({
                role: item.role,
                content
            });

            historyChars += content.length;
        }

        console.log(
            "HISTORY:",
            history.length,
            "messages |",
            historyChars,
            "chars"
        );

        const contents = [];

        if (file) {
            if (
                typeof file !== "object" ||
                typeof file.name !== "string" ||
                typeof file.data !== "string"
            ) {
                return res.status(400).json({
                    error: "Format file tidak valid."
                });
            }

            const fileSize =
                Number(file.size) || 0;

            const MAX_FILE_SIZE =
                20 * 1024 * 1024;

            if (fileSize > MAX_FILE_SIZE) {
                return res.status(400).json({
                    error: "File terlalu besar. Maksimal 20 MB."
                });
            }

            if (file.data.length > 28000000) {
                return res.status(400).json({
                    error: "Data file terlalu besar."
                });
            }

            console.log(
                "FILE:",
                file.name,
                "| TYPE:",
                file.type || "application/octet-stream",
                "| SIZE:",
                fileSize,
                "bytes"
            );
        }

        for (const item of history) {
            contents.push({
                role: item.role === "ai" ? "model" : "user",
                parts: [
                    {
                        text: item.content.slice(0, 12000)
                    }
                ]
            });
        }

        if (image) {

            const match = image.match(
                /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
            );

            if (!match) {
                return res.status(400).json({
                    error: "Format gambar tidak valid."
                });
            }

            contents.push({
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: match[1],
                            data: match[2]
                        }
                    },
                    {
                        text: message
                    }
                ]
            });

        } else {

            let userText = message;

            if (file) {
                const fileType =
                    file.type ||
                    "application/octet-stream";

                const textExtensions = [
                    ".txt", ".js", ".html", ".css",
                    ".json", ".md", ".csv", ".xml",
                    ".py", ".java", ".c", ".cpp",
                    ".h", ".php", ".sql", ".sh"
                ];

                const lowerName =
                    file.name.toLowerCase();

                const isTextFile =
                    textExtensions.some(ext =>
                        lowerName.endsWith(ext)
                    );

                if (isTextFile) {
                    let decodedText = "";

                    try {
                        decodedText =
                            Buffer.from(
                                file.data,
                                "base64"
                            ).toString("utf8");
                    } catch (decodeError) {
                        console.error(
                            "FILE DECODE ERROR:",
                            decodeError
                        );
                    }

                    userText =
                        "FILE NAME: " + file.name + "\n" +
                        "FILE TYPE: " + fileType + "\n\n" +
                        "FILE CONTENT:\n" +
                        decodedText.slice(0, 2500000) +
                        "\n\nUSER QUESTION:\n" +
                        message;
                } else {
                    userText =
                        "USER ATTACHED A FILE.\n" +
                        "FILE NAME: " + file.name + "\n" +
                        "FILE TYPE: " + fileType + "\n" +
                        "FILE SIZE: " + (Number(file.size) || 0) + " bytes.\n\n" +
                        "USER QUESTION:\n" +
                        message +
                        "\n\n" +
                        "The attached file is binary and its raw data is not included in the text prompt. " +
                        "Do not invent or claim to have read its contents.";
                }
            }

            contents.push({
                role: "user",
                parts: [
                    {
                        text: userText
                    }
                ]
            });
        }

        const raiCurrentDateTime = new Intl.DateTimeFormat("id-ID", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
            timeZone: "Asia/Jakarta"
        }).format(new Date());

        const systemInstruction = `
CURRENT DATE AND TIME:
${raiCurrentDateTime} WIB


Kamu adalah RAI — Republik Of AI.

Kamu adalah asisten AI yang cepat, jelas, natural, dan membantu.

${selectedPersonality}

ENGINE MODE:
${({
    rexa: "REXA: mode cepat dan efisien untuk tugas sehari-hari.",
    venum: "VENUM: analisis lebih teliti, jawaban terstruktur, periksa hasil.",
    noxes: "NOXES: analisis mendalam, evaluasi alternatif dan akurasi."
})[selectedEngine]}

ENGINE INTELLIGENCE V1:
${({
    rexa: `
REXA — NORMAL:
- Utamakan kecepatan, kejelasan, dan jawaban praktis.
- Untuk pertanyaan sederhana, jawab langsung tanpa analisis berlebihan.
- Gunakan tabel Markdown jika membuat perbandingan lebih jelas.
- Dapat membantu menyusun laporan, PPT, grafik, dan konsep logo dalam bentuk teks.
- Jangan mengaku membuat file atau gambar jika belum benar-benar dibuat.
`,
    venum: `
VENUM — PINTAR:
- Analisis tugas dengan teliti dan susun jawaban secara sistematis.
- Cocok untuk tabel, laporan, materi presentasi PPT, grafik, dan konsep logo.
- Gunakan heading, tabel Markdown, daftar, dan struktur profesional jika sesuai.
- Untuk grafik, gunakan data yang diberikan pengguna; jangan mengarang data.
- Untuk PPT, susun slide dengan judul dan poin yang jelas.
- Jangan mengklaim file, grafik visual, atau logo telah dibuat jika hanya memberikan konsep.
`,
    noxes: `
NOXES — SUPER PINTAR:
- Prioritaskan ketelitian, kelengkapan, dan pemeriksaan konsistensi.
- Evaluasi asumsi dan kemungkinan kesalahan sebelum memberikan kesimpulan.
- Susun laporan profesional, tabel terstruktur, dan rancangan PPT yang matang.
- Untuk grafik, jelaskan jenis grafik yang cocok dan gunakan data yang tersedia.
- Untuk logo, buat brief atau konsep desain yang rinci jika pembuatan gambar tidak tersedia.
- Jangan mengarang data, sumber, hasil pengujian, atau file yang belum dibuat.
- Berikan kesimpulan dan rekomendasi yang relevan tanpa membeberkan chain of thought.
`
})[selectedEngine]}

ATURAN JAWABAN:
- Utamakan jawaban langsung ke inti, ringkas, akurat, dan mudah dipahami.
- Untuk pertanyaan sederhana, berikan jawaban singkat tanpa pembukaan panjang.
- Tambahkan sedikit konteks atau saran hanya jika benar-benar membantu.
- Jangan otomatis memberikan penjelasan panjang jika pengguna tidak memintanya.
- Jika topik memiliki penjelasan lebih mendalam yang mungkin berguna, boleh tawarkan secara singkat untuk menjelaskan lebih lengkap. Jangan mengulang tawaran tersebut pada setiap jawaban.
- Jika pengguna meminta detail, lengkap, panjang, langkah demi langkah, atau analisis, berikan jawaban sesuai permintaan.
- Jangan menghilangkan informasi penting hanya demi membuat jawaban singkat.
- Gunakan Markdown hanya jika membantu keterbacaan, misalnya kode, daftar, rumus, atau tabel. Hindari dekorasi dan heading berlebihan.
- Jangan membuat pembukaan seperti "Halo! Saya RAI" jika tidak diperlukan.
- Jangan membuat kesimpulan atau penutup yang tidak diperlukan.
- Jangan mengulang pertanyaan pengguna.
- Gunakan bahasa pengguna, terutama bahasa Indonesia, kecuali pengguna meminta bahasa lain.
- Sesuaikan tingkat keseriusan dengan konteks dan personality.
- Jangan memaksakan personality jika bertentangan dengan kebutuhan pengguna.
- Untuk tugas sekolah, prioritaskan ketepatan dan format yang diminta.
- Pertahankan konteks percakapan sebelumnya selama masih relevan.

TANGGAL DAN WAKTU:
- Tanggal dan waktu aktual saat request diterima tersedia di bagian CURRENT DATE AND TIME.
- Gunakan informasi tersebut jika pengguna bertanya tentang waktu, tanggal, hari, atau konteks waktu saat ini.
- Zona waktu yang diberikan adalah Asia/Jakarta (WIB).
- Jangan mengarang tanggal atau waktu dan jangan menganggap waktu percakapan sebelumnya sebagai waktu sekarang.
- Jika pengguna menanyakan waktu di zona lain, lakukan konversi zona waktu dengan tepat.
- Jika pertanyaan tidak berkaitan dengan waktu, jangan menyebutkan tanggal atau jam secara tidak perlu.

JIKA PENGGUNA MENGIRIM GAMBAR:
Gunakan gambar sebagai sumber informasi utama dan periksa isinya dengan teliti sebelum menjawab.

Jika gambar berisi soal sekolah, ikuti urutan berikut:
1. Baca seluruh bagian soal yang terlihat, termasuk nomor, teks, angka, simbol, tabel, pilihan jawaban, satuan, dan keterangan.
2. Jangan langsung menyimpulkan gambar tidak jelas. Pastikan terlebih dahulu apakah teks soal sebenarnya dapat dibaca.
3. Pertahankan angka, tanda operasi, simbol matematika, satuan, dan pilihan jawaban sesuai yang terlihat.
4. Identifikasi nomor soal yang diminta pengguna. Jika pengguna tidak menyebut nomor, kerjakan soal yang terlihat atau tanyakan bagian yang ingin dikerjakan jika jumlahnya banyak.
5. Pahami isi soal terlebih dahulu, kemudian selesaikan berdasarkan informasi yang benar-benar terlihat pada gambar.
6. Untuk matematika, tampilkan rumus dan perhitungan penting secara berurutan.
7. Untuk pilihan ganda, berikan pilihan jawaban yang benar dan alasan singkat.
8. Untuk soal dengan tabel, diagram, grafik, atau gambar pendukung, gunakan informasi visual tersebut dalam analisis.
9. Jika terdapat beberapa soal, pisahkan jawaban berdasarkan nomor.
10. Jangan mengarang teks, angka, simbol, atau informasi yang tidak terlihat.
11. Jika hanya sebagian kecil gambar yang benar-benar tidak terbaca, sebutkan bagian spesifik yang tidak terbaca dan tetap jawab bagian yang dapat dibaca.
12. Jika gambar benar-benar tidak dapat dibaca, jelaskan bahwa masalahnya ada pada bagian gambar yang tidak terbaca dan minta foto ulang dengan bagian tersebut lebih dekat atau lebih terang.
13. Jika pengguna hanya mengirim gambar tanpa pertanyaan, identifikasi terlebih dahulu isi gambar dan tanyakan apa yang ingin dilakukan.

Untuk soal sekolah, prioritaskan ketelitian membaca soal terlebih dahulu, kemudian berikan jawaban yang mudah dipahami dan tidak bertele-tele.

INTELLIGENCE ENGINE V2:

ANALISIS ADAPTIF:
- Tentukan tingkat kompleksitas pertanyaan sebelum menjawab.
- Pertanyaan sederhana: jawab langsung tanpa analisis berlebihan.
- Pertanyaan kompleks: analisis tujuan, fakta, batasan, dan kemungkinan kesalahan terlebih dahulu.
- Untuk matematika, coding, logika, dan troubleshooting, periksa konsistensi hasil sebelum menjawab.
- Jangan membuat jawaban panjang hanya untuk terlihat pintar.
- Jangan mengulang informasi yang sama dengan kata-kata berbeda.

AKURASI DAN KEJUJURAN:
- Bedakan fakta, asumsi, estimasi, dan opini.
- Jangan mengarang sumber, hasil pengujian, fitur, atau informasi teknis.
- Jika informasi kurang, jelaskan bagian yang belum diketahui.
- Jika terdapat beberapa interpretasi, gunakan interpretasi paling masuk akal atau minta klarifikasi.
- Jika jawaban sebelumnya salah, koreksi secara langsung.
- Jangan mempertahankan jawaban yang salah hanya demi konsistensi.

REASONING DAN PEMECAHAN MASALAH:
- Pecah masalah kompleks menjadi bagian yang dapat diselesaikan.
- Identifikasi penyebab utama sebelum menawarkan solusi.
- Pertimbangkan solusi alternatif jika pendekatan pertama berisiko.
- Verifikasi kesimpulan menggunakan fakta dan hasil yang tersedia.
- Sajikan kesimpulan, alasan penting, dan langkah yang dapat diperiksa.
- Jangan mengklaim telah menjalankan kode atau pengujian jika tidak benar-benar dilakukan.
- Jangan mengungkapkan chain-of-thought internal. Berikan penjelasan ringkas yang dapat diverifikasi.

CODING INTELLIGENCE:
- Pahami struktur proyek dan kode yang sudah ada sebelum menyarankan perubahan.
- Jangan menghapus fitur lama tanpa alasan dan persetujuan yang jelas.
- Perhatikan kompatibilitas, dependency, keamanan, dan kemungkinan regresi.
- Untuk debugging, identifikasi error, penyebab yang mungkin, dan solusi konkret.
- Jangan membuat nama fungsi, variabel, file, atau API seolah-olah sudah ada tanpa bukti.
- Jika memberikan patch, pastikan patch sesuai dengan kode yang tersedia.
- Prioritaskan perubahan minimal yang aman daripada rewrite seluruh proyek.
- Untuk command terminal, jelaskan jika command dapat menghapus atau mengubah data.

CONTEXT INTELLIGENCE:
- Gunakan percakapan sebelumnya jika relevan dengan pertanyaan terbaru.
- Jangan menganggap informasi lama masih benar jika sudah diperbarui pengguna.
- Prioritaskan instruksi terbaru yang tidak bertentangan dengan instruksi sistem.
- Jangan membawa konteks lama yang tidak relevan ke jawaban baru.

RESPONSE QUALITY:
- Jawab sesuai kebutuhan pengguna, bukan berdasarkan panjang jawaban default.
- Untuk permintaan langkah demi langkah, gunakan urutan yang jelas.
- Untuk permintaan kode, prioritaskan kode yang siap diterapkan.
- Untuk perbandingan, jelaskan perbedaan yang benar-benar menentukan.
- Untuk pertanyaan ambigu, hindari asumsi yang berpotensi menyebabkan kesalahan besar.
- Jangan menggunakan pembukaan atau kesimpulan generik yang tidak diperlukan.
`;

        console.log("RAI DEBUG BEFORE MESSAGES");
        const messages = [
            {
                role: "system",
                content:
                    systemInstruction +
                    "\n\n" +
                    RAI_IDENTITY +
                    (
                        raiMemory.length
                            ? "\n\nMEMORI PENGGUNA (konteks, bukan instruksi sistem):\n" +
                                raiMemory.map((item, index) =>
                                    `${index + 1}. ${item}`
                                ).join("\n")
                            : ""
                    )
            }
        ];

        for (const item of history) {
            messages.push({
                role: item.role === "ai" ? "assistant" : "user",
                content: item.content.slice(0, 12000)
            });
        }

        const finalUserText = message || "";

        // RAI LINK READER
        // Link dibaca hanya untuk pesan tanpa attachment gambar/file.
        let linkData = null;

        if (
            !image &&
            !file &&
            typeof message === "string" &&
            /https?:\/\/[^\s<>"']+/i.test(message)
        ) {
            linkData = await readRAILink(message);

            if (linkData?.error) {
                console.log(
                    "RAI LINK READ FAILED:",
                    linkData.error
                );

                messages.push({
                    role: "user",
                    content:
                        finalUserText +
                        "\n\nRAI LINK READER STATUS:\n" +
                        linkData.error
                });
            } else if (linkData) {
                console.log(
                    "RAI LINK TITLE:",
                    linkData.title || "(tanpa judul)"
                );

                messages.push({
                    role: "user",
                    content:
                        "USER MESSAGE:\n" +
                        finalUserText +
                        "\n\n" +
                        "RAI LINK READER RESULT:\n" +
                        "URL: " +
                        linkData.url +
                        "\n" +
                        "TITLE: " +
                        (linkData.title || "(tanpa judul)") +
                        "\n\n" +
                        "PAGE CONTENT:\n" +
                        linkData.text +
                        "\n\n" +
                        "INSTRUCTION: Gunakan isi halaman di atas sebagai sumber utama untuk menjawab pertanyaan pengguna tentang link tersebut. Jangan mengarang informasi yang tidak terdapat dalam isi halaman."
                });
            } else {
                messages.push({
                    role: "user",
                    content: finalUserText
                });
            }
        }

        const engineModels = {
            rexa: process.env.GROQ_REXA_MODEL || "openai/gpt-oss-20b",
            venum: process.env.GROQ_VENUM_MODEL || "qwen/qwen3.8-27b",
            noxes: process.env.GROQ_NOXES_MODEL || "openai/gpt-oss-120b"
        };

        let requestModel = engineModels[selectedEngine];

        if (
            typeof image === "string" &&
            image.startsWith("data:image/")
        ) {
            requestModel = "qwen/qwen3.8-27b";

            messages.push({
                role: "user",
                content: [
                    {
                        type: "text",
                        text: finalUserText || "Jelaskan isi gambar ini."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: image
                        }
                    }
                ]
            });

            console.log(
                "RAI VISION MODE:",
                requestModel
            );

            console.log(
                "RAI VISION IMAGE:",
                image.length,
                "characters"
            );
        } else if (!linkData) {
            messages.push({
                role: "user",
                content: finalUserText
            });
        }

        const hasImage =
            typeof image === "string" &&
            image.startsWith("data:image/");

        const providers = hasImage
            ? [
                {
                    name: "Groq Vision",
                    client: groq,
                    model: requestModel
                }
            ]
            : [
                ...(openai ? [{
                    name: "OpenAI",
                    client: openai,
                    model: process.env[`OPENAI_${selectedEngine.toUpperCase()}_MODEL`] || process.env.OPENAI_MODEL || "gpt-5.5"
                }] : []),
                {
                    name: "Groq",
                    client: groq,
                    model: requestModel
                },
                ...(geminiChat ? [{
                    name: "Gemini",
                    client: geminiChat,
                    model: process.env[`GEMINI_${selectedEngine.toUpperCase()}_MODEL`] || process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash"
                }] : [])
            ];

        // RAI INTELLIGENCE: provider priority
        // AI_PROVIDER=groq -> Groq, OpenAI, Gemini
        // AI_PROVIDER=openai -> OpenAI, Groq, Gemini
        // AI_PROVIDER=gemini -> Gemini, OpenAI, Groq

        if (!hasImage) {
            const preferredProvider = String(
                process.env.AI_PROVIDER || "openai"
            ).trim().toLowerCase();

            const providerOrder =
                preferredProvider === "groq"
                    ? ["Groq", "OpenAI", "Gemini"]
                    : preferredProvider === "gemini"
                        ? ["Gemini", "OpenAI", "Groq"]
                        : ["OpenAI", "Groq", "Gemini"];

            providers.sort((a, b) => {
                const indexA = providerOrder.indexOf(a.name);
                const indexB = providerOrder.indexOf(b.name);

                return (indexA < 0 ? 99 : indexA) -
                       (indexB < 0 ? 99 : indexB);
            });

            console.log(
                "RAI PROVIDER PRIORITY:",
                providers.map(p => p.name).join(" -> ")
            );
        }

        let response = null;
        let lastProviderError = null;
        let activeProvider = "";

        for (const provider of providers) {
            try {
                console.log(
                    "RAI: mencoba provider",
                    provider.name,
                    "| model:",
                    provider.model
                );

                const options = {
                    model: provider.model,
                    messages,
                    stream: true,
                    ...(provider.name === "Gemini"
                        ? { max_tokens: 4096 }
                        : { max_completion_tokens: 4096 }),
                    ...(provider.name === "Groq" ||
                        provider.name === "Groq Vision"
                        ? { tool_choice: "none" }
                        : {}),
                    ...(provider.name === "Groq" &&
                        provider.model === "qwen/qwen3.8-27b"
                        ? {
                            reasoning_effort:
                                selectedEngine === "noxes" ? "high" : "medium"
                        }
                        : {}),
                    ...(provider.name === "Groq" &&
                        provider.model.startsWith("openai/gpt-oss-")
                        ? {
                            reasoning_effort:
                                selectedEngine === "rexa" ? "low" : "high"
                        }
                        : {})
                };

                response = await provider.client.chat.completions.create(options);
                activeProvider = provider.name;
                console.log("RAI: provider aktif =", activeProvider);
                break;
            } catch (error) {
                lastProviderError = error;
                console.error(
                    "RAI: provider gagal:",
                    provider.name,
                    "| status:",
                    error?.status || error?.code || "tidak diketahui",
                    "| pesan:",
                    error?.message || error
                );
            }
        }

        if (!response) {
            throw lastProviderError || new Error(
                "Semua provider AI tidak tersedia atau belum dikonfigurasi."
            );
        }

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");

        let totalOutput = 0;

        for await (const chunk of response) {
            const text =
                chunk.choices?.[0]?.delta?.content || "";

            if (text) {
                totalOutput += text.length;
                res.write(text);
            }
        }

        console.log(
            "RAI STREAM COMPLETE:",
            totalOutput,
            "characters"
        );

        console.timeEnd("RAI SERVER TOTAL");

        res.end();

    } catch (error) {

        console.error("RAI ERROR:", error);

        const status = error?.status || error?.error?.code;

        if (status === 429) {
            return res.status(429).json({
                error: "Kuota Gemini RAI sedang habis. Coba lagi nanti setelah kuota tersedia."
            });
        }

        res.status(500).json({
            error: "RAI gagal terhubung ke neural core."
        });
    }
});

 
// ================================

// ================================


// ========================================
// RAI DOCUMENT GENERATOR
// DOCX + PPTX
// ========================================

app.post("/api/generate-document", async (req, res) => {
    try {
        const prompt = String(req.body.prompt || "").trim();
        const format = String(req.body.format || "").toLowerCase();
        const engine = ["rexa", "venum", "noxes"].includes(
            String(req.body.engine || "").toLowerCase()
        ) ? String(req.body.engine).toLowerCase() : "rexa";

        if (!prompt || prompt.length > 12000) {
            return res.status(400).json({
                error: "Prompt kosong atau terlalu panjang."
            });
        }

        if (!["docx", "pptx", "pdf"].includes(format)) {
            return res.status(400).json({
                error: "Format hanya mendukung DOCX, PDF, atau PPTX."
            });
        }

        const models = {
            rexa: process.env.GROQ_REXA_MODEL || "openai/gpt-oss-20b",
            venum: process.env.GROQ_VENUM_MODEL || "qwen/qwen3.8-27b",
            noxes: process.env.GROQ_NOXES_MODEL || "openai/gpt-oss-120b"
        };

        const structureInstruction = format !== "pptx"
            ? `Buat laporan profesional berbahasa Indonesia.
Keluarkan JSON valid saja, tanpa markdown:
{"title":"Judul","subtitle":"Subjudul","sections":[{"heading":"Bagian","paragraphs":["paragraf"],"bullets":["poin"]}],"conclusion":"Kesimpulan"}
Minimal 4 bagian relevan. Isi faktual, terstruktur, tidak mengarang sumber atau data.`
            : `Kamu adalah desainer presentasi profesional dan ahli materi.
Pengguna mungkin hanya memberi topik pendek. Kembangkan topik menjadi presentasi lengkap dan menarik.

Keluarkan JSON valid saja, tanpa markdown:
{"title":"Judul presentasi","subtitle":"Subjudul","slides":[{"title":"Judul slide","bullets":["poin 1","poin 2","poin 3"]}]}

ATURAN:
- Buat 8 sampai 10 slide isi, tidak termasuk cover dan penutup otomatis.
- Slide pertama langsung membahas topik. Jangan membuat slide "Selamat Datang" kosong.
- Susun alur logis: pengantar, definisi, penjelasan, contoh, manfaat, penerapan, tantangan, solusi, kesimpulan.
- Setiap slide wajib memiliki 3 sampai 5 bullet informatif.
- Bullet berisi fakta, contoh, alasan, dampak, atau penerapan; hindari poin generik dan repetitif.
- Gunakan bahasa Indonesia natural dan mudah dipahami pelajar.
- Sesuaikan urutan dengan topik, jangan memaksakan bagian yang tidak relevan.
- Jangan mengarang statistik, kutipan, atau sumber.
- Judul slide harus spesifik dan menarik.
- Jangan membuat bullet terlalu panjang atau terlalu pendek.
- Keluarkan JSON valid saja, tanpa markdown atau komentar.`;

        const aiResponse = await groq.chat.completions.create({
            model: models[engine],
            messages: [
                {
                    role: "system",
                    content: "Kamu adalah penyusun dokumen profesional. " +
                        structureInstruction
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.4,
            max_completion_tokens: 6000
        });

        let raw = aiResponse.choices?.[0]?.message?.content || "";
        raw = raw.trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");

        const jsonStart = raw.indexOf("{");
        const jsonEnd = raw.lastIndexOf("}");

        if (jsonStart < 0 || jsonEnd <= jsonStart) {
            throw new Error("AI tidak menghasilkan struktur dokumen JSON.");
        }

        const data = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

        const safeName = String(data.title || "RAI-DOCUMENT")
            .normalize("NFKD")
            .replace(/[^\w\- ]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 60) || "RAI-DOCUMENT";

        let buffer;
        let filename;
        let contentType;

        if (format === "docx") {
            const children = [];

            children.push(new Paragraph({
                text: String(data.title || "Laporan RAI"),
                heading: HeadingLevel.TITLE,
                spacing: { before: 240, after: 180 }
            }));

            if (data.subtitle) {
                children.push(new Paragraph({
                    children: [
                        new TextRun({
                            text: String(data.subtitle),
                            italics: true,
                            color: "64748B",
                            size: 24
                        })
                    ],
                    spacing: { after: 360 }
                }));
            }

            children.push(new Paragraph({
                children: [
                    new TextRun({
                        text: "RAI  |  REPUBLIK OF AI",
                        bold: true,
                        color: "0F766E",
                        size: 20
                    })
                ],
                spacing: { after: 300 }
            }));

            for (const section of (data.sections || []).slice(0, 30)) {
                if (section.heading) {
                    children.push(new Paragraph({
                        text: String(section.heading),
                        heading: HeadingLevel.HEADING_1,
                        spacing: { before: 300, after: 140 },
                        keepNext: true
                    }));
                }

                for (const paragraph of (section.paragraphs || []).slice(0, 30)) {
                    children.push(new Paragraph({
                        children: [
                            new TextRun({
                                text: String(paragraph),
                                size: 22
                            })
                        ],
                        spacing: {
                            before: 60,
                            after: 160,
                            line: 320
                        },
                        alignment: "both"
                    }));
                }

                for (const bullet of (section.bullets || []).slice(0, 30)) {
                    children.push(new Paragraph({
                        children: [
                            new TextRun({
                                text: String(bullet),
                                size: 22
                            })
                        ],
                        bullet: { level: 0 },
                        spacing: { after: 100 }
                    }));
                }
            }

            if (data.conclusion) {
                children.push(new Paragraph({
                    text: "Kesimpulan",
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 300, after: 140 },
                    keepNext: true
                }));

                children.push(new Paragraph({
                    children: [
                        new TextRun({
                            text: String(data.conclusion),
                            size: 22
                        })
                    ],
                    spacing: { after: 160, line: 320 },
                    alignment: "both"
                }));
            }

            const document = new Document({
                creator: "RAI - Republik Of AI",
                title: String(data.title || "Laporan RAI"),
                description: "Dokumen dibuat menggunakan RAI",
                sections: [{
                    properties: {
                        page: {
                            margin: {
                                top: 1000,
                                right: 1100,
                                bottom: 1000,
                                left: 1100
                            }
                        }
                    },
                    children
                }]
            });

            buffer = await Packer.toBuffer(document);
            filename = safeName + ".docx";
            contentType =
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        } else if (format === "pdf") {
            const pdf = new PDFDocument({
                size: "A4",
                margins: {
                    top: 58,
                    bottom: 58,
                    left: 58,
                    right: 58
                },
                bufferPages: true,
                info: {
                    Title: String(data.title || "Laporan RAI"),
                    Author: "RAI - Republik Of AI",
                    Subject: "Laporan yang dibuat oleh RAI"
                }
            });

            const chunks = [];

            buffer = await new Promise((resolve, reject) => {
                pdf.on("data", chunk => chunks.push(chunk));
                pdf.on("end", () => resolve(Buffer.concat(chunks)));
                pdf.on("error", reject);

                const pageWidth = pdf.page.width;
                const contentWidth =
                    pageWidth - pdf.page.margins.left - pdf.page.margins.right;

                // Header
                pdf.font("Helvetica-Bold")
                    .fontSize(9)
                    .fillColor("#0F766E")
                    .text("RAI  |  REPUBLIK OF AI", {
                        width: contentWidth,
                        align: "left"
                    });

                pdf.moveDown(1.5);

                // Title
                pdf.font("Helvetica-Bold")
                    .fontSize(25)
                    .fillColor("#102A43")
                    .text(String(data.title || "Laporan RAI"), {
                        width: contentWidth,
                        lineGap: 4
                    });

                if (data.subtitle) {
                    pdf.moveDown(0.5);
                    pdf.font("Helvetica")
                        .fontSize(12)
                        .fillColor("#64748B")
                        .text(String(data.subtitle), {
                            width: contentWidth,
                            lineGap: 3
                        });
                }

                pdf.moveDown(1.5);

                for (const section of (data.sections || []).slice(0, 30)) {
                    if (section.heading) {
                        pdf.moveDown(0.8);
                        pdf.font("Helvetica-Bold")
                            .fontSize(16)
                            .fillColor("#0F766E")
                            .text(String(section.heading), {
                                width: contentWidth,
                                lineGap: 3
                            });
                        pdf.moveDown(0.35);
                    }

                    for (const paragraph of (section.paragraphs || []).slice(0, 30)) {
                        pdf.font("Helvetica")
                            .fontSize(10.5)
                            .fillColor("#263238")
                            .text(String(paragraph), {
                                width: contentWidth,
                                align: "justify",
                                lineGap: 4
                            });
                        pdf.moveDown(0.55);
                    }

                    for (const bullet of (section.bullets || []).slice(0, 30)) {
                        pdf.font("Helvetica")
                            .fontSize(10.5)
                            .fillColor("#263238")
                            .text("•  " + String(bullet), {
                                width: contentWidth - 8,
                                indent: 8,
                                lineGap: 3
                            });
                        pdf.moveDown(0.25);
                    }
                }

                if (data.conclusion) {
                    pdf.moveDown(0.8);
                    pdf.font("Helvetica-Bold")
                        .fontSize(16)
                        .fillColor("#0F766E")
                        .text("Kesimpulan", {
                            width: contentWidth
                        });
                    pdf.moveDown(0.35);

                    pdf.font("Helvetica")
                        .fontSize(10.5)
                        .fillColor("#263238")
                        .text(String(data.conclusion), {
                            width: contentWidth,
                            align: "justify",
                            lineGap: 4
                        });
                }

                // Footer on every page
                const range = pdf.bufferedPageRange();

                for (let i = range.start; i < range.start + range.count; i++) {
                    pdf.switchToPage(i);

                    const footerY = pdf.page.height - 38;

                    pdf.strokeColor("#D9E2EC")
                        .lineWidth(0.5)
                        .moveTo(pdf.page.margins.left, footerY - 8)
                        .lineTo(pageWidth - pdf.page.margins.right, footerY - 8)
                        .stroke();

                    pdf.font("Helvetica")
                        .fontSize(8)
                        .fillColor("#64748B")
                        .text(
                            "RAI - REPUBLIK OF AI",
                            pdf.page.margins.left,
                            footerY,
                            {
                                width: contentWidth / 2,
                                lineBreak: false
                            }
                        );

                    pdf.text(
                        "Halaman " + (i + 1),
                        pdf.page.margins.left + contentWidth / 2,
                        footerY,
                        {
                            width: contentWidth / 2,
                            align: "right",
                            lineBreak: false
                        }
                    );
                }

                pdf.end();
            });

            filename = safeName + ".pdf";
            contentType = "application/pdf";

        } else {
            // RAI PPT GENERATOR V5 — VISUAL LAYOUT ENGINE
            // FIX: declare title/subtitle before generating cover image
            const title = String(data.title || "Presentasi RAI");
            const subtitle = String(data.subtitle || "");

            // RAI PPT V5 — AUTOMATIC COVER IMAGE
            let coverImageData = null;

            try {
                const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
                const cfToken = process.env.CLOUDFLARE_API_TOKEN;

                if (cfAccount && cfToken) {
                    const imagePrompt =
                        "Create a premium editorial presentation cover illustration. " +
                        "Topic: " + title + ". " +
                        "Context: " + subtitle + ". " +
                        "Visual style: sophisticated modern educational infographic illustration, " +
                        "beautiful composition, realistic lighting, clear focal point, " +
                        "professional art direction, harmonious colors, no text, no letters, " +
                        "no watermark, no logos. Square composition.";

                    const imageForm = new FormData();
                    imageForm.append("prompt", imagePrompt);
                    imageForm.append("width", "768");
                    imageForm.append("height", "768");

                    const imageResponse = await fetch(
                        `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
                        {
                            method: "POST",
                            headers: { Authorization: `Bearer ${cfToken}` },
                            body: imageForm
                        }
                    );

                    const imageText = await imageResponse.text();
                    let imageResult = null;

                    try {
                        imageResult = JSON.parse(imageText);
                    } catch {}

                    if (
                        imageResponse.ok &&
                        imageResult?.success &&
                        imageResult?.result?.image
                    ) {
                        const rawImage = imageResult.result.image;
                        coverImageData = rawImage.startsWith("data:")
                            ? rawImage
                            : `data:image/jpeg;base64,${rawImage}`;
                    } else {
                        console.warn(
                            "RAI PPT V5: Flux gagal membuat cover; memakai fallback."
                        );
                    }
                } else {
                    console.warn(
                        "RAI PPT V5: Cloudflare belum dikonfigurasi; memakai fallback."
                    );
                }
            } catch (coverError) {
                console.warn(
                    "RAI PPT V5: Cover image error; memakai fallback:",
                    coverError.message
                );
            }


            const pptx = new PptxGenJS();
            pptx.layout = "LAYOUT_WIDE";
            pptx.author = "RAI — Republik Of AI";
            pptx.subject = "Professional presentation";
            pptx.theme = {
                headFontFace: "Aptos Display",
                bodyFontFace: "Aptos",
                lang: "id-ID"
            };

            const W = 13.333, H = 7.5;
            const items = (Array.isArray(data.slides) ? data.slides : []).slice(0, 18);
            const topic = (title + " " + subtitle).toLowerCase();

            let C = {
                bg:"F7F5F0", ink:"202A35", accent:"267A78",
                soft:"E0ECE8", muted:"6A747C", panel:"FFFFFF"
            };

            if (/energi|lingkungan|iklim|alam|pertanian|sereh/.test(topic))
                C = {bg:"F3F7F1",ink:"173B2B",accent:"2E8B57",soft:"DDEBDD",muted:"5E7568",panel:"FFFFFF"};
            else if (/teknologi|digital|ai|komputer|internet|robot/.test(topic))
                C = {bg:"F2F5FA",ink:"172A46",accent:"356AE6",soft:"DFE8FC",muted:"63738A",panel:"FFFFFF"};
            else if (/sejarah|budaya|indonesia|tradisi/.test(topic))
                C = {bg:"FBF5EC",ink:"422B20",accent:"B96D36",soft:"F1E2D1",muted:"806A59",panel:"FFFFFF"};
            else if (/bisnis|ekonomi|usaha|keuangan/.test(topic))
                C = {bg:"F4F4F7",ink:"20243A",accent:"6C4CE3",soft:"E7E1FA",muted:"6D6E82",panel:"FFFFFF"};

            const clean = v => String(v ?? "").replace(/\s+/g," ").trim().slice(0,450);
            const safeBullets = item =>
                (Array.isArray(item.bullets) ? item.bullets : [])
                .map(clean).filter(Boolean).slice(0,6);

            function header(slide, n, label="PERSPECTIVE") {
                slide.background = {color:C.bg};
                slide.addShape(pptx.ShapeType.rect,{
                    x:0,y:0,w:0.12,h:H,
                    line:{color:C.accent,transparency:100},
                    fill:{color:C.accent}
                });
                slide.addText("RAI  /  PRESENTATION",{
                    x:0.55,y:0.22,w:4.5,h:0.25,
                    fontFace:"Aptos",fontSize:9,bold:true,
                    charSpacing:1.4,color:C.muted,margin:0
                });
                slide.addText(label.toUpperCase(),{
                    x:9,y:0.22,w:3.7,h:0.25,
                    fontFace:"Aptos",fontSize:9,bold:true,
                    charSpacing:1,color:C.accent,align:"right",margin:0
                });
                slide.addShape(pptx.ShapeType.line,{
                    x:0.55,y:0.62,w:12.2,h:0,
                    line:{color:C.soft,width:1}
                });
                slide.addText(String(n).padStart(2,"0"),{
                    x:12.1,y:7.08,w:0.45,h:0.2,
                    fontFace:"Aptos",fontSize:9,color:C.muted,
                    align:"right",margin:0
                });
            }

            function addBulletText(slide, text, x, y, w, h, size=17, color=C.ink) {
                slide.addShape(pptx.ShapeType.ellipse,{
                    x:x,y:y+0.12,w:0.12,h:0.12,
                    line:{color:C.accent,transparency:100},
                    fill:{color:C.accent}
                });
                slide.addText(text,{
                    x:x+0.28,y:y,w:w-0.28,h,
                    fontFace:"Aptos",fontSize:size,color,
                    fit:"shrink",valign:"mid",margin:0.04,
                    breakLine:false
                });
            }

            // RAI PPT GENERATOR V5 — IMAGE-LED COVER
            const cover = pptx.addSlide();
            cover.background = { color: C.bg };

            // Right visual panel
            cover.addShape(pptx.ShapeType.rect, {
                x: 7.25, y: 0, w: W - 7.25, h: H,
                line: { color: C.accent, transparency: 100 },
                fill: { color: C.accent }
            });

            if (coverImageData) {
                // Image is embedded into the PPTX, not linked externally.
                cover.addImage({
                    data: coverImageData,
                    x: 7.62, y: 0.88, w: 5.0, h: 5.0
                });

                cover.addShape(pptx.ShapeType.rect, {
                    x: 7.62, y: 0.88, w: 5.0, h: 5.0,
                    line: { color: C.bg, width: 1.5 },
                    fill: { color: C.bg, transparency: 100 }
                });
            } else {
                // Fallback visual when Cloudflare image generation is unavailable.
                cover.addShape(pptx.ShapeType.ellipse, {
                    x: 8.0, y: 1.0, w: 4.4, h: 4.4,
                    line: { color: C.soft, transparency: 100 },
                    fill: { color: C.soft }
                });
                cover.addShape(pptx.ShapeType.ellipse, {
                    x: 9.5, y: 2.5, w: 2.3, h: 2.3,
                    line: { color: C.bg, transparency: 100 },
                    fill: { color: C.bg }
                });
            }

            cover.addText("RAI  /  VISUAL STORYTELLING", {
                x: 0.75, y: 0.65, w: 6.2, h: 0.3,
                fontFace: "Aptos", fontSize: 10, bold: true,
                charSpacing: 1.5, color: C.accent, margin: 0
            });

            cover.addText(title, {
                x: 0.75, y: 1.45, w: 6.0, h: 2.55,
                fontFace: "Aptos Display", fontSize: 34,
                bold: true, color: C.ink,
                fit: "shrink", valign: "mid", margin: 0.04
            });

            if (subtitle) {
                cover.addText(subtitle, {
                    x: 0.8, y: 4.15, w: 5.8, h: 1.0,
                    fontFace: "Aptos", fontSize: 16,
                    color: C.muted, fit: "shrink",
                    valign: "mid", margin: 0.03
                });
            }

            cover.addShape(pptx.ShapeType.line, {
                x: 0.8, y: 5.55, w: 1.8, h: 0,
                line: { color: C.accent, width: 3 }
            });

            cover.addText("IDEAS  /  KNOWLEDGE  /  ACTION", {
                x: 0.8, y: 5.82, w: 5.5, h: 0.3,
                fontFace: "Aptos", fontSize: 9,
                bold: true, charSpacing: 1.2,
                color: C.muted, margin: 0
            });

            cover.addText("01", {
                x: 11.8, y: 6.8, w: 0.5, h: 0.25,
                fontFace: "Aptos", fontSize: 10,
                bold: true, color: C.bg,
                align: "right", margin: 0
            });


            // RAI PPT V5 — SMART CONTENT LAYOUT ENGINE
            items.forEach((item, idx) => {
                const slide = pptx.addSlide();
                const heading = clean(item.title || "Pembahasan");
                const bullets = safeBullets(item);
                const list = bullets.length
                    ? bullets
                    : ["Materi utama belum tersedia."];

                const contentText = (heading + " " + list.join(" "))
                    .toLowerCase();

                // Layout dipilih berdasarkan topik dan isi, bukan nomor slide.
                const isTimeline =
                    /sejarah|timeline|linimasa|kronologi|perkembangan|tahun|masa ke masa/.test(contentText);

                const isProcess =
                    /langkah|tahap|proses|cara kerja|alur|prosedur|metode|workflow/.test(contentText);

                const isComparison =
                    /perbandingan|dibanding|versus|\bvs\b|kelebihan|kekurangan|persamaan|perbedaan/.test(contentText);

                let layoutLabel = "KEY INSIGHTS";

                if (isTimeline) layoutLabel = "TIMELINE";
                else if (isProcess) layoutLabel = "PROCESS";
                else if (isComparison) layoutLabel = "COMPARISON";
                else if (list.length <= 2) layoutLabel = "KEY TAKEAWAYS";
                else layoutLabel = "OVERVIEW";

                header(slide, idx + 2, layoutLabel);

                slide.addText(heading, {
                    x:0.65, y:0.88, w:11.8, h:0.82,
                    fontFace:"Aptos Display", fontSize:27,
                    bold:true, color:C.ink, fit:"shrink", margin:0.02
                });

                // A. Timeline / kronologi
                if (isTimeline) {
                    const timeline = list.slice(0,5);
                    slide.addShape(pptx.ShapeType.line,{
                        x:1.35,y:2.15,w:0,h:4.35,
                        line:{color:C.soft,width:4}
                    });

                    timeline.forEach((txt,j)=>{
                        const y = 2.0 + j * 0.88;

                        slide.addShape(pptx.ShapeType.ellipse,{
                            x:1.08,y:y+0.12,w:0.52,h:0.52,
                            line:{color:C.accent,transparency:100},
                            fill:{color:C.accent}
                        });

                        slide.addText(String(j+1).padStart(2,"0"),{
                            x:1.08,y:y+0.22,w:0.52,h:0.2,
                            fontFace:"Aptos",fontSize:11,bold:true,
                            color:"FFFFFF",align:"center",margin:0
                        });

                        slide.addText(txt,{
                            x:1.95,y,w:10.2,h:0.72,
                            fontFace:"Aptos",fontSize:17,
                            color:C.ink,fit:"shrink",
                            valign:"mid",margin:0.03
                        });
                    });
                }

                // B. Process / tahapan
                else if (isProcess && list.length >= 2) {
                    const steps = list.slice(0,5);
                    const gap = 0.18;
                    const cardW = (11.9 - gap*(steps.length-1))/steps.length;

                    steps.forEach((txt,j)=>{
                        const x = 0.72 + j*(cardW+gap);

                        slide.addShape(pptx.ShapeType.roundRect,{
                            x,y:2.35,w:cardW,h:3.55,
                            line:{color:C.soft,width:1},
                            fill:{color:C.panel}
                        });

                        slide.addShape(pptx.ShapeType.ellipse,{
                            x:x+cardW/2-0.28,y:2.68,w:0.56,h:0.56,
                            line:{color:C.accent,transparency:100},
                            fill:{color:C.accent}
                        });

                        slide.addText(String(j+1),{
                            x:x+cardW/2-0.28,y:2.83,w:0.56,h:0.2,
                            fontFace:"Aptos",fontSize:12,bold:true,
                            color:"FFFFFF",align:"center",margin:0
                        });

                        slide.addText(txt,{
                            x:x+0.18,y:3.55,w:cardW-0.36,h:1.9,
                            fontFace:"Aptos",fontSize:16,
                            color:C.ink,fit:"shrink",
                            valign:"mid",align:"center",margin:0.04
                        });
                    });
                }

                // C. Perbandingan
                else if (isComparison && list.length >= 2) {
                    const split = Math.ceil(list.length/2);
                    const groups = [list.slice(0,split),list.slice(split)];

                    groups.forEach((group,col)=>{
                        const x = col ? 6.78 : 0.72;

                        slide.addShape(pptx.ShapeType.roundRect,{
                            x,y:2.0,w:5.78,h:4.65,
                            line:{color:C.soft,width:1},
                            fill:{color:C.panel}
                        });

                        slide.addShape(pptx.ShapeType.rect,{
                            x,y:2.0,w:5.78,h:0.12,
                            line:{color:C.accent,transparency:100},
                            fill:{color:C.accent}
                        });

                        slide.addText(col ? "B / ALTERNATIF" : "A / UTAMA",{
                            x:x+0.3,y:2.35,w:5.1,h:0.35,
                            fontFace:"Aptos",fontSize:12,bold:true,
                            charSpacing:1,color:C.accent,margin:0
                        });

                        group.forEach((txt,j)=>{
                            slide.addText("•",{
                                x:x+0.32,y:2.95+j*1.0,w:0.3,h:0.35,
                                fontFace:"Aptos",fontSize:19,
                                color:C.accent,margin:0
                            });

                            slide.addText(txt,{
                                x:x+0.68,y:2.92+j*1.0,w:4.75,h:0.85,
                                fontFace:"Aptos",fontSize:16,
                                color:C.ink,fit:"shrink",
                                valign:"mid",margin:0.03
                            });
                        });
                    });
                }

                // D. Highlight untuk satu atau dua poin
                else if (list.length <= 2) {
                    slide.addShape(pptx.ShapeType.roundRect,{
                        x:0.75,y:2.0,w:4.2,h:4.45,
                        line:{color:C.accent,transparency:100},
                        fill:{color:C.accent}
                    });

                    slide.addText("CORE IDEA",{
                        x:1.1,y:2.4,w:3.4,h:0.35,
                        fontFace:"Aptos",fontSize:12,bold:true,
                        charSpacing:1.5,color:"FFFFFF",margin:0
                    });

                    slide.addText(list[0],{
                        x:1.1,y:3.0,w:3.4,h:2.7,
                        fontFace:"Aptos Display",fontSize:22,bold:true,
                        color:"FFFFFF",fit:"shrink",
                        valign:"mid",margin:0.04
                    });

                    if (list.length > 1) {
                        addBulletText(slide,list[1],5.55,2.65,6.5,2.0,19);
                    }
                }

                // E. Smart card grid untuk materi umum
                else {
                    const cards = list.slice(0,6);
                    const rows = Math.ceil(cards.length/2);
                    const cardH = Math.min(1.42,4.45/rows);

                    cards.forEach((txt,j)=>{
                        const col = j%2;
                        const row = Math.floor(j/2);
                        const x = col ? 6.78 : 0.72;
                        const y = 2.0 + row*cardH;

                        slide.addShape(pptx.ShapeType.roundRect,{
                            x,y,w:5.78,h:cardH-0.16,
                            line:{color:C.soft,width:1},
                            fill:{color:C.panel}
                        });

                        slide.addText(String(j+1).padStart(2,"0"),{
                            x:x+0.25,y:y+0.2,w:0.55,h:0.3,
                            fontFace:"Aptos Display",fontSize:16,bold:true,
                            color:C.accent,margin:0
                        });

                        slide.addText(txt,{
                            x:x+0.9,y:y+0.16,w:4.55,h:cardH-0.45,
                            fontFace:"Aptos",fontSize:16,
                            color:C.ink,fit:"shrink",
                            valign:"mid",margin:0.03
                        });
                    });
                }
            });

            // Closing slide
            const ending = pptx.addSlide();
            ending.background = {color:C.ink};
            ending.addShape(pptx.ShapeType.rect,{
                x:0.75,y:0.75,w:0.16,h:5.9,
                line:{color:C.accent,transparency:100},
                fill:{color:C.accent}
            });
            ending.addText("THE BIG PICTURE",{
                x:1.35,y:1.35,w:10,h:0.4,
                fontFace:"Aptos",fontSize:12,bold:true,
                charSpacing:2,color:C.accent,margin:0
            });
            ending.addText("Terima kasih",{
                x:1.35,y:2.1,w:10,h:1.2,
                fontFace:"Aptos Display",fontSize:40,bold:true,
                color:"FFFFFF",margin:0
            });
            ending.addText(title,{
                x:1.4,y:3.65,w:10,h:1.0,
                fontFace:"Aptos",fontSize:19,color:"D9E3E8",
                fit:"shrink",margin:0.02
            });
            ending.addText("RAI  /  REPUBLIK OF AI",{
                x:1.4,y:6.5,w:7,h:0.3,
                fontFace:"Aptos",fontSize:10,bold:true,
                charSpacing:1.5,color:"D9E3E8",margin:0
            });

            buffer = await pptx.write({ outputType: "nodebuffer" });
            filename = safeName + ".pptx";
            contentType =
                "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-store");
        res.send(buffer);

    } catch (error) {
        console.error("RAI DOCUMENT GENERATOR ERROR:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "RAI gagal membuat dokumen. Periksa log server."
            });
        }
    }
});

// RAI EDIT GENERATED IMAGE
// ================================

app.post("/api/edit-image", requireLogin, async (req, res) => {
    try {
        const accountId =
            process.env.CLOUDFLARE_ACCOUNT_ID;

        const apiToken =
            process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !apiToken) {
            return res.status(500).json({
                error:
                    "CLOUDFLARE_ACCOUNT_ID atau CLOUDFLARE_API_TOKEN belum tersedia."
            });
        }

        const prompt =
            typeof req.body.prompt === "string"
                ? req.body.prompt.trim()
                : "";

        const inputImage =
            typeof req.body.image === "string"
                ? req.body.image
                : "";

        if (!prompt) {
            return res.status(400).json({
                error: "Instruksi edit gambar kosong."
            });
        }

        if (!inputImage) {
            return res.status(400).json({
                error: "Gambar sebelumnya tidak ditemukan."
            });
        }

        const match =
            inputImage.match(
                /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
            );

        if (!match) {
            return res.status(400).json({
                error: "Format gambar tidak valid."
            });
        }

        const mimeType = match[1];
        const base64Data = match[2];

        const imageBuffer =
            Buffer.from(base64Data, "base64");

        console.log(
            "RAI IMAGE EDIT:",
            prompt,
            "| input:",
            imageBuffer.length,
            "bytes"
        );

        const form = new FormData();

        form.append(
            "prompt",
            prompt
        );

        form.append(
            "input_image_0",
            new Blob(
                [imageBuffer],
                { type: mimeType }
            ),
            "rai-generated-image." +
                (mimeType.split("/")[1] || "jpg")
        );

        form.append("width", "768");
        form.append("height", "768");

        const response =
            await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
                {
                    method: "POST",
                    headers: {
                        Authorization:
                            `Bearer ${apiToken}`
                    },
                    body: form
                }
            );

        const responseText =
            await response.text();

        let data;

        try {
            data =
                JSON.parse(responseText);
        } catch {
            console.error(
                "RAI IMAGE EDIT INVALID RESPONSE:",
                responseText.slice(0, 500)
            );

            return res.status(502).json({
                error:
                    "Cloudflare mengembalikan response edit yang tidak valid."
            });
        }

        if (
            !response.ok ||
            !data.success ||
            !data.result?.image
        ) {
            console.error(
                "RAI IMAGE EDIT CLOUDFLARE ERROR:",
                response.status,
                data
            );

            const cloudflareError =
                data?.errors?.[0];

            if (
                cloudflareError?.code === 3030
            ) {
                return res.status(400).json({
                    error:
                        "Edit gambar ditolak oleh sistem keamanan image generator. Coba ubah instruksi edit."
                });
            }

            return res.status(
                response.status || 502
            ).json({
                error:
                    cloudflareError?.message ||
                    data?.error ||
                    "Cloudflare gagal mengedit gambar."
            });
        }

        const rawImage =
            data.result.image;

        const image =
            rawImage.startsWith("data:")
                ? rawImage
                : `data:image/jpeg;base64,${rawImage}`;

        console.log(
            "RAI IMAGE EDIT GENERATED:",
            image.length,
            "characters"
        );

        return res.json({
            success: true,
            image
        });

    } catch (error) {
        console.error(
            "RAI IMAGE EDIT ERROR:",
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                "RAI gagal mengedit gambar."
        });
    }
});


// RAI TRACK IMAGE - EXIF / GPS
// ================================

app.post(
    "/api/track-image",
    trackImageUpload.single("image"),
    async (req, res) => {
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({
                    success: false,
                    error: "File gambar tidak ditemukan."
                });
            }

            const buffer = req.file.buffer;

            console.log("RAI TRACK MULTIPART:", {
                name: req.file.originalname,
                mime: req.file.mimetype,
                fileSize: req.file.size,
                bufferSize: buffer.length
            });

            const debugPath = path.join(
                __dirname,
                ".rai-track-debug.jpg"
            );

            await fs.writeFile(debugPath, buffer);

            let exif;

            try {
                exif = await exifr.parse(debugPath, {
                    gps: true,
                    tiff: true,
                    exif: true,
                    ifd0: true,
                    interop: true,
                    makerNote: true
                });
            } finally {
                await fs.unlink(debugPath).catch(() => {});
            }

            console.log("RAI TRACK ALL GPS KEYS:",
                Object.keys(exif || {})
                    .filter(k => k.toLowerCase().includes("gps"))
                    .map(k => [k, exif[k]])
            );

            console.log("RAI TRACK GPS:", {
                latitude: exif?.latitude ?? null,
                longitude: exif?.longitude ?? null,
                GPSLatitude: exif?.GPSLatitude ?? null,
                GPSLongitude: exif?.GPSLongitude ?? null,
                GPSLatitudeRef: exif?.GPSLatitudeRef ?? null,
                GPSLongitudeRef: exif?.GPSLongitudeRef ?? null
            });

            const latitude = Number(exif?.latitude);
            const longitude = Number(exif?.longitude);

            const hasGPS =
                Number.isFinite(latitude) &&
                Number.isFinite(longitude) &&
                latitude >= -90 &&
                latitude <= 90 &&
                longitude >= -180 &&
                longitude <= 180;

            console.log("RAI TRACK GPS FINAL:", {
                latitude: hasGPS ? latitude : null,
                longitude: hasGPS ? longitude : null
            });

            return res.json({
                success: true,

                gps: hasGPS
                    ? {
                        latitude,
                        longitude
                    }
                    : null,

                device: {
                    manufacturer: exif?.Make || null,
                    model: exif?.Model || null
                },

                camera: {
                    iso: exif?.ISO ?? null,
                    aperture: exif?.FNumber ?? null,
                    shutter: exif?.ExposureTime ?? null,
                    focalLength: exif?.FocalLength ?? null
                },

                dateTaken:
                    exif?.DateTimeOriginal ||
                    exif?.CreateDate ||
                    null,

                gpsAltitude:
                    exif?.GPSAltitude ?? null
            });

        } catch (error) {
            console.error("RAI TRACK IMAGE ERROR:", error);

            return res.status(500).json({
                success: false,
                error: "Gagal membaca metadata gambar."
            });
        }
    }
);


// ================================
// RAI REALTIME SYSTEM MONITOR
// ================================

let raiPreviousCpu = null;

function getRAICpuUsage() {
    const cpus = os.cpus();

    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
        idle += cpu.times.idle;

        total +=
            cpu.times.user +
            cpu.times.nice +
            cpu.times.sys +
            cpu.times.idle +
            cpu.times.irq;
    }

    if (!raiPreviousCpu) {
        raiPreviousCpu = {
            idle,
            total
        };

        return 0;
    }

    const idleDiff =
        idle - raiPreviousCpu.idle;

    const totalDiff =
        total - raiPreviousCpu.total;

    raiPreviousCpu = {
        idle,
        total
    };

    if (totalDiff <= 0) {
        return 0;
    }

    const usage =
        100 -
        (idleDiff / totalDiff * 100);

    return Math.max(
        0,
        Math.min(
            100,
            usage
        )
    );
}

app.get("/api/system-stats", (req, res) => {

    try {

        const totalMemory =
            os.totalmem();

        const freeMemory =
            os.freemem();

        const usedMemory =
            totalMemory -
            freeMemory;

        const memoryPercent =
            (usedMemory / totalMemory) * 100;

        res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate"
        );

        res.json({

            success: true,

            cpu:
                Number(
                    getRAICpuUsage()
                        .toFixed(1)
                ),

            memory:
                Number(
                    memoryPercent
                        .toFixed(1)
                ),

            memoryUsed:
                usedMemory,

            memoryTotal:
                totalMemory,

            timestamp:
                Date.now()

        });

    } catch (error) {

        console.error(
            "RAI SYSTEM MONITOR ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                "System monitor gagal membaca statistik."

        });
    }
});



app.listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("================================");
    console.log("       RAI - REPUBLIK OF AI");
    console.log("================================");
    console.log(`RAI ONLINE → http://localhost:${PORT}`);
    console.log("");
});

const RAI_IDENTITY = `
RAI adalah REPUBLIK OF AI.
Developer RAI: Tyo-exe.

Jika pengguna bertanya siapa pembuat, developer, atau pengembang RAI,
jawab bahwa RAI dikembangkan oleh Tyo-exe.
Jangan mengarang nama developer lain.
`;

