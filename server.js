require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const Groq = require("groq-sdk");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const { setupAuth } = require("./auth");

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

            return res.status(
                response.status || 502
            ).json({
                error:
                    data?.errors?.[0]?.message ||
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

        const systemInstruction = `
Kamu adalah RAI — Republik Of AI.

Kamu adalah asisten AI yang cepat, jelas, natural, dan membantu.

${selectedPersonality}

ATURAN JAWABAN:
- Jawab langsung ke inti.
- Berikan jawaban yang lengkap dan mudah dipahami.
- Untuk pertanyaan sederhana, jawab secukupnya.
- Untuk pertanyaan yang membutuhkan penjelasan, berikan penjelasan yang panjang dan lengkap.
- Jangan sengaja memendekkan jawaban hanya agar cepat selesai.
- Jangan gunakan Markdown.
- Jangan gunakan simbol dekoratif.
- Jangan gunakan ###, ##, #, **, *, __, ---, atau blok kode.
- Jika perlu membuat daftar, gunakan nomor biasa atau kalimat terpisah tanpa simbol dekoratif.
- Jangan membuat pembukaan seperti "Halo! Saya RAI" jika tidak diperlukan.
- Jangan membuat kesimpulan atau penutup yang tidak diperlukan.
- Jangan mengulang pertanyaan pengguna.
- Gunakan bahasa Indonesia kecuali pengguna meminta bahasa lain.
- Sesuaikan tingkat keseriusan jawaban dengan konteks percakapan.
- Jangan memaksakan gaya personality jika bertentangan dengan kebutuhan pengguna.
- Jika pengguna meminta tugas sekolah atau penjelasan penting, prioritaskan ketepatan dan kejelasan.
- Jika pengguna sedang bercanda, boleh mengikuti suasana dengan humor ringan.
- Pertahankan konteks percakapan sebelumnya selama masih relevan.

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
`;

        console.log("RAI DEBUG BEFORE MESSAGES");
        const messages = [
            {
                role: "system",
                content: systemInstruction
            }
        ];

        for (const item of history) {
            messages.push({
                role: item.role === "ai" ? "assistant" : "user",
                content: item.content.slice(0, 12000)
            });
        }

        const finalUserText = message || "";

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
        } else {
            messages.push({
                role: "user",
                content: finalUserText
            });
        }

        console.log("RAI DEBUG BEFORE GROQ:", requestModel);
        const response = await groq.chat.completions.create({
            model: requestModel,
            messages,
            max_completion_tokens: 4096,
            stream: true
        });

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


app.listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("================================");
    console.log("       RAI - REPUBLIK OF AI");
    console.log("================================");
    console.log(`RAI ONLINE → http://localhost:${PORT}`);
    console.log("");
});
