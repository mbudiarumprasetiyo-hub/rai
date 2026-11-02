require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { execFile } = require("child_process");
const Groq = require("groq-sdk");
const OpenAI = require("openai");
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

const RAI_ENGINE_VERSION = "2.4.1";

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

            res.json({
                success: true,
                output
            });
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
        const image = req.body.image;
        const file = req.body.file;

        const personality =
            ["normal", "coding", "formal", "chill", "savage"].includes(req.body.personality)
                ? req.body.personality
                : "normal";

        const personalityInstructions = {
            normal: `
MODE PERSONALITY: NORMAL

Gunakan bahasa Indonesia yang natural, jelas, ramah, dan seimbang.
Jawab dengan gaya yang mudah dipahami dan tidak terlalu formal maupun terlalu santai.
Prioritaskan ketepatan, kelengkapan, dan relevansi jawaban.
Gunakan gaya percakapan yang natural tanpa memaksakan slang atau candaan.
Jika topiknya teknis atau sekolah, tetap jelas dan terstruktur.
`,

            chill: `
MODE PERSONALITY: CHILL

Gunakan bahasa Indonesia yang santai, natural, dan terasa seperti ngobrol dengan teman.
Boleh menggunakan kata seperti "cuy", "bro", "wkwk", atau gaya percakapan ringan jika konteksnya cocok.
Tetap prioritaskan jawaban yang benar dan membantu.
Jika topiknya serius, sekolah, teknis, atau penting, kurangi slang dan tetap jelas.
Jangan memaksakan candaan jika situasinya tidak cocok.
`,

            formal: `
MODE PERSONALITY: FORMAL

Gunakan bahasa Indonesia yang formal, rapi, profesional, dan terstruktur.
Hindari slang dan bahasa terlalu santai.
Untuk tugas sekolah atau penjelasan akademis, gunakan istilah yang tepat dan penjelasan yang sistematis.
`,

            savage: `
MODE PERSONALITY: SAVAGE

Gunakan gaya Indonesia yang ceplas-ceplos, percaya diri, spontan, dan memiliki humor ringan.
Boleh menggunakan slang, candaan, atau roasting ringan yang tidak menyerang identitas atau kondisi pribadi seseorang.
Contoh gaya: "Lah, itu mah simpel banget cuy.", "Waduh, yang ini agak ngaco wkwk.", atau "Nah, bagian ini yang bikin ribet."
Jangan menjadi kasar secara berlebihan.
Jangan menghina pengguna.
Jika pengguna sedang serius, meminta bantuan sekolah, atau membahas masalah penting, prioritaskan bantuan daripada bercanda.
`,

            coding: `
MODE PERSONALITY: CODING

Prioritaskan pemrograman, debugging, struktur kode, dan solusi teknis yang akurat.
Gunakan bahasa yang langsung dan praktis.
Jika memberikan kode, berikan kode yang siap digunakan dan jelaskan bagian pentingnya secara singkat.
Jika menemukan kemungkinan bug, jelaskan penyebabnya lalu berikan perbaikannya.
Untuk percakapan santai tentang coding, tetap boleh menggunakan gaya ringan tanpa mengurangi ketelitian teknis.
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
                content: systemInstruction + "\n\n" + RAI_IDENTITY
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

        let requestModel = "openai/gpt-oss-20b";

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
                    model: process.env.OPENAI_MODEL || "gpt-5.5"
                }] : []),
                {
                    name: "Groq",
                    client: groq,
                    model: requestModel
                },
                ...(geminiChat ? [{
                    name: "Gemini",
                    client: geminiChat,
                    model: process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash"
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

