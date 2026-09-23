console.log("RAI SCRIPT LOADED");
console.log("RAI JS STARTED");
let currentController = null;
window.addEventListener("error", function(e) { document.body.innerHTML += "<pre style=\"position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#ff3333;padding:20px;z-index:999999;font-size:14px;white-space:pre-wrap;overflow:auto\">RAI JS ERROR\n\nMESSAGE: " + String(e.message) + "\n\nLINE: " + String(e.lineno) + "\nCOLUMN: " + String(e.colno) + "\nFILE: " + String(e.filename) + "\n\nERROR: " + String(e.error) + "\n\nSTACK: " + (e.error && e.error.stack ? e.error.stack : "NO STACK") + "</pre>"; });
let typingTimer = null;


window.addEventListener("error", function(e) { document.body.innerHTML += "<pre style=\"position:fixed;top:0;left:0;right:0;background:#000;color:#ff3333;padding:20px;z-index:999999;font-size:14px;white-space:pre-wrap\">RAI JS ERROR:\n" + e.message + "\nLINE: " + e.lineno + "\nFILE: " + e.filename + "</pre>"; });

const chat = document.getElementById("chat");
const input = document.getElementById("message");
const typing = document.getElementById("typing");

const imageInput = document.getElementById("imageInput");
const imageBtn = document.getElementById("imageBtn");
const imagePreview = document.getElementById("imagePreview");
const galleryBtn = document.getElementById("galleryBtn");

let selectedImage = null;

/* ==============================
   RAI CHAT HISTORY
   ============================== */

const RAI_HISTORY_KEY = "RAI_CHAT_HISTORY_V1";
const RAI_CURRENT_CHAT_KEY = "RAI_CURRENT_CHAT_V1";

let currentChatId =
    localStorage.getItem(RAI_CURRENT_CHAT_KEY) ||
    ("rai-" + Date.now() + "-" + Math.random().toString(36).slice(2))


let chatHistory = [];

try {
    chatHistory =
        JSON.parse(
            localStorage.getItem(RAI_HISTORY_KEY)
        ) || [];
} catch {
    chatHistory = [];
}

function saveChatHistory() {
    localStorage.setItem(
        RAI_HISTORY_KEY,
        JSON.stringify(chatHistory)
    );

    localStorage.setItem(
        RAI_CURRENT_CHAT_KEY,
        currentChatId
    );
}

function getCurrentChat() {
    let current =
        chatHistory.find(
            chat => chat.id === currentChatId
        );

    if (!current) {
        current = {
            id: currentChatId,
            title: "Percakapan Baru",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        };

        chatHistory.unshift(current);
    }

    return current;
}

function saveUserMessage(message, image = null) {
    const current = getCurrentChat();

    if (
        current.messages.length === 0 ||
        current.title === "Percakapan Baru"
    ) {
        current.title =
            message.length > 40
                ? message.slice(0, 40) + "..."
                : message;
    }

    current.messages.push({
        role: "user",
        content: message,
        image: image || null,
        timestamp: Date.now()
    });

    current.updatedAt = Date.now();

    saveChatHistory();
}

function saveAIMessage(message) {
    if (!message) return;

    const current = getCurrentChat();

    current.messages.push({
        role: "ai",
        content: message,
        timestamp: Date.now()
    });

    current.updatedAt = Date.now();

    saveChatHistory();
}



let selectedFile = null;

function openFilePicker() {
    const fileInput = document.getElementById("fileInput");

    if (fileInput) {
        fileInput.click();
    }
}

function handleFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const MAX_FILE_SIZE = 20 * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
        alert("File terlalu besar. Maksimal 20 MB.");
        event.target.value = "";
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {

        const result = e.target.result;

        if (typeof result !== "string") {
            alert("RAI gagal membaca file.");
            event.target.value = "";
            return;
        }

        let base64 = "";
        let mimeType = file.type || "application/octet-stream";

        if (result.startsWith("data:")) {
            const comma = result.indexOf(",");

            if (comma === -1) {
                alert("Format file tidak valid.");
                event.target.value = "";
                return;
            }

            base64 = result.slice(comma + 1);
        } else {
            base64 = result;
        }

        selectedFile = {
            name: file.name,
            type: mimeType,
            size: file.size,
            data: base64
        };

        const messageInput =
            document.getElementById("message");

        if (messageInput) {
            messageInput.placeholder =
                "File: " +
                file.name +
                " — tulis pertanyaan...";

            messageInput.focus();
        }

        const fileBtn =
            document.getElementById("fileBtn");

        if (fileBtn) {
            fileBtn.textContent = "📄";
            fileBtn.title = file.name;
            fileBtn.classList.add("file-selected");
        }

        showFilePreview();

        console.log(
            "RAI FILE SELECTED:",
            file.name,
            file.type || "application/octet-stream",
            file.size,
            "bytes"
        );
    };

    reader.onerror = function() {
        console.error("RAI FILE READ ERROR");

        alert("RAI gagal membaca file.");

        selectedFile = null;
        event.target.value = "";
    };

    reader.readAsDataURL(file);
}
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showFilePreview() {
    const preview = document.getElementById("filePreview");

    if (!preview || !selectedFile) return;

    const size =
        selectedFile.size < 1024
            ? selectedFile.size + " B"
            : (selectedFile.size / 1024).toFixed(1) + " KB";

    preview.hidden = false;

    preview.innerHTML = `
        <div class="file-preview-icon">📄</div>

        <div class="file-preview-info">
            <div class="file-preview-name">
                ${escapeHtml(selectedFile.name)}
            </div>

            <div class="file-preview-size">
                ${size}
            </div>
        </div>

        <button
            type="button"
            class="file-preview-remove"
            onclick="removeFile()"
            title="Hapus file"
        >×</button>
    `;
}

function removeFile() {
    selectedFile = null;

    const fileInput = document.getElementById("fileInput");

    if (fileInput) {
        fileInput.value = "";
    }

    const fileBtn = document.getElementById("fileBtn");

    if (fileBtn) {
        fileBtn.textContent = "📎";
        fileBtn.title = "Pilih File";
        fileBtn.classList.remove("file-selected");
    }

    const messageInput = document.getElementById("message");

    if (messageInput) {
        messageInput.placeholder =
            "Masukkan perintah atau pertanyaan...";
    }

    const preview = document.getElementById("filePreview");

    if (preview) {
        preview.hidden = true;
        preview.innerHTML = "";
    }
}

function getMemoryContext() {
    const current = getCurrentChat();

    if (!current || !current.messages) {
        return [];
    }

    return current.messages
        .slice(-12)
        .map(item => ({
            role: item.role,
            content: item.content || ""
        }))
        .filter(item => item.content.trim());
}

const bootLines = [
    "[BOOT] Loading RAI kernel...",
    "[OK] Neural network initialized.",
    "[OK] Encryption layer activated.",
    "[OK] Matrix interface loaded.",
    "[OK] Terminal connection established.",
    "[OK] Republik Of AI is ready."
];

let bootIndex = 0;

function boot() {

    const text = document.getElementById("bootText");
    const bar = document.getElementById("loadingBar");
    const status = document.getElementById("bootStatus");

    const timer = setInterval(() => {

        if (bootIndex < bootLines.length) {

            const line = document.createElement("div");
            line.textContent = bootLines[bootIndex];

            text.appendChild(line);

            bootIndex++;

            bar.style.width =
                ((bootIndex / bootLines.length) * 100) + "%";

        } else {

            clearInterval(timer);

            status.textContent = "SYSTEM ONLINE";

            setTimeout(() => {

                const bootScreen =
                    document.getElementById("boot");

                bootScreen.style.opacity = "0";

                setTimeout(() => {
                    bootScreen.style.display = "none";
                }, 800);

            }, 700);
        }

    }, 300);
}

console.log("RAI: CALLING BOOT");
boot();
console.log("RAI: BOOT CALLED");

function renderCodeBlocks(text, container) {

    /*
     * RAI CODE WORKSPACE AUTO-DETECT
     *
     * Gemini kadang mengirim HTML tanpa ```html ... ```.
     * Jika ditemukan dokumen HTML lengkap, ubah sementara
     * menjadi code fence agar renderer Workspace yang sama
     * tetap digunakan.
     */

    const rawHtmlPattern =
        /<!DOCTYPE\s+html[\s\S]*?<\/html\s*>/i;

    if (
        !/```/.test(text) &&
        rawHtmlPattern.test(text)
    ) {

        const htmlMatch =
            text.match(rawHtmlPattern);

        if (htmlMatch) {

            const htmlCode =
                htmlMatch[0];

            const before =
                text.slice(0, htmlMatch.index);

            const after =
                text.slice(
                    htmlMatch.index + htmlCode.length
                );

            text =
                before +
                "\n```html\n" +
                htmlCode +
                "\n```\n" +
                after;
        }
    }

    const codeRegex =
        /```([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g;

    let lastIndex = 0;
    let match;

    while ((match = codeRegex.exec(text)) !== null) {

        const normalText =
            text.slice(lastIndex, match.index);

        if (normalText.trim()) {
            const normal = document.createElement("p");
            normal.textContent = normalText;
            container.appendChild(normal);
        }

        const language =
            (match[1] || "text").toLowerCase();

        const codeText =
            match[2].trim();

        const codeBox =
            document.createElement("div");

        codeBox.className = "code-block rai-code-workspace";

        const workspaceTitle =
            document.createElement("div");

        workspaceTitle.className =
            "rai-workspace-title";

        workspaceTitle.innerHTML =
            '<span>◈ RAI CODE WORKSPACE</span>' +
            '<span class="rai-code-language">' +
            escapeHtml(language.toUpperCase()) +
            '</span>';

        const codeHeader =
            document.createElement("div");

        codeHeader.className =
            "code-header";

        const codeLabel =
            document.createElement("span");

        codeLabel.textContent =
            getCodeFileName(language);

        const codeActions =
            document.createElement("div");

        codeActions.className =
            "rai-code-actions";

        const codeCopy =
            document.createElement("button");

        codeCopy.type = "button";
        codeCopy.className =
            "code-copy-btn";

        codeCopy.textContent =
            "COPY";

        const codeDownload =
            document.createElement("button");

        codeDownload.type = "button";
        codeDownload.className =
            "code-copy-btn";

        codeDownload.textContent =
            "DOWNLOAD";

        const codePreview =
            document.createElement("button");

        codePreview.type = "button";
        codePreview.className =
            "code-copy-btn";

        codePreview.textContent =
            "RUN";

        const code =
            document.createElement("pre");

        code.className =
            "code-content";

        code.textContent =
            codeText;

        codeCopy.onclick = async () => {

            try {

                await navigator.clipboard.writeText(
                    codeText
                );

                codeCopy.textContent =
                    "COPIED";

                setTimeout(() => {
                    codeCopy.textContent =
                        "COPY";
                }, 1200);

            } catch (error) {

                console.error(
                    "RAI CODE COPY ERROR:",
                    error
                );

                codeCopy.textContent =
                    "FAILED";

                setTimeout(() => {
                    codeCopy.textContent =
                        "COPY";
                }, 1200);
            }
        };

        codeDownload.onclick = () => {

            try {

                const extension =
                    getCodeExtension(language);

                const fileName =
                    getCodeFileName(language);

                const finalName =
                    fileName.includes(".")
                        ? fileName
                        : fileName + extension;

                const blob =
                    new Blob(
                        [codeText],
                        { type: "text/plain;charset=utf-8" }
                    );

                const url =
                    URL.createObjectURL(blob);

                const link =
                    document.createElement("a");

                link.href = url;
                link.download = finalName;

                document.body.appendChild(link);
                link.click();
                link.remove();

                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);

            } catch (error) {

                console.error(
                    "RAI CODE DOWNLOAD ERROR:",
                    error
                );
            }
        };

        codePreview.onclick = () => {

            if (!isPreviewableCode(language)) {

                codePreview.textContent =
                    "HTML ONLY";

                setTimeout(() => {
                    codePreview.textContent =
                        "PREVIEW";
                }, 1400);

                return;
            }

            showCodePreview(
                codeText,
                codePreview
            );
        };

        codeActions.appendChild(codeCopy);
        codeActions.appendChild(codeDownload);

        if (isPreviewableCode(language)) {
            codeActions.appendChild(codePreview);
        }

        codeHeader.appendChild(codeLabel);
        codeHeader.appendChild(codeActions);

        codeBox.appendChild(workspaceTitle);
        codeBox.appendChild(codeHeader);
        codeBox.appendChild(code);

        container.appendChild(codeBox);

        lastIndex =
            codeRegex.lastIndex;
    }

    const remaining =
        text.slice(lastIndex);

    if (remaining) {

        const normal =
            document.createElement("p");

        normal.textContent =
            remaining;

        container.appendChild(normal);
    }
}

function getCodeExtension(language) {

    const map = {
        html: ".html",
        htm: ".html",
        css: ".css",
        javascript: ".js",
        js: ".js",
        typescript: ".ts",
        ts: ".ts",
        python: ".py",
        py: ".py",
        java: ".java",
        c: ".c",
        cpp: ".cpp",
        "c++": ".cpp",
        h: ".h",
        php: ".php",
        sql: ".sql",
        json: ".json",
        xml: ".xml",
        bash: ".sh",
        sh: ".sh",
        shell: ".sh",
        markdown: ".md",
        md: ".md",
        text: ".txt",
        txt: ".txt"
    };

    return map[language] || ".txt";
}

function getCodeFileName(language) {

    const names = {
        html: "index.html",
        htm: "index.html",
        css: "style.css",
        javascript: "script.js",
        js: "script.js",
        typescript: "script.ts",
        ts: "script.ts",
        python: "script.py",
        py: "script.py",
        java: "Main.java",
        c: "main.c",
        cpp: "main.cpp",
        "c++": "main.cpp",
        h: "main.h",
        php: "index.php",
        sql: "query.sql",
        json: "data.json",
        xml: "data.xml",
        bash: "script.sh",
        sh: "script.sh",
        shell: "script.sh",
        markdown: "README.md",
        md: "README.md",
        text: "RAI-code.txt",
        txt: "RAI-code.txt"
    };

    return names[language] || "RAI-code.txt";
}

function isPreviewableCode(language) {

    return [
        "html",
        "htm"
    ].includes(language);
}

function showCodePreview(codeText, button) {

    const workspace =
        button.closest(".rai-code-workspace");

    if (!workspace) {
        console.error("RAI PREVIEW: workspace tidak ditemukan");
        return;
    }

    const existing =
        workspace.querySelector(".rai-code-preview");

    if (existing) {
        existing.remove();
        button.textContent = "RUN";
        return;
    }

    let htmlCode =
        String(codeText || "").trim();

    htmlCode = htmlCode
        .replace(/^```html\s*/i, "")
        .replace(/^```htm\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

    const htmlMatch =
        htmlCode.match(
            /<!DOCTYPE\s+html[\s\S]*?<\/html\s*>/i
        ) ||
        htmlCode.match(
            /<html(?:\s[^>]*)?>[\s\S]*?<\/html\s*>/i
        );

    if (htmlMatch) {
        htmlCode = htmlMatch[0];
    }

    console.log(
        "RAI WEB RUNNER V2:",
        htmlCode.length,
        "characters"
    );

    const preview =
        document.createElement("div");

    preview.className =
        "rai-code-preview";

    const previewBar =
        document.createElement("div");

    previewBar.className =
        "rai-preview-bar";

    const previewTitle =
        document.createElement("span");

    previewTitle.textContent =
        "◉ RAI WEB RUNNER";

    const previewActions =
        document.createElement("div");

    previewActions.className =
        "rai-preview-actions";

    const refreshBtn =
        document.createElement("button");

    refreshBtn.type = "button";
    refreshBtn.className = "rai-preview-control";
    refreshBtn.textContent = "↻ REFRESH";
    refreshBtn.title = "Refresh preview";

    const fullscreenBtn =
        document.createElement("button");

    fullscreenBtn.type = "button";
    fullscreenBtn.className = "rai-preview-control";
    fullscreenBtn.textContent = "⛶ FULL";
    fullscreenBtn.title = "Fullscreen preview";

    const closeBtn =
        document.createElement("button");

    closeBtn.type = "button";
    closeBtn.className = "rai-preview-control";
    closeBtn.textContent = "CLOSE";
    closeBtn.title = "Tutup preview";

    const frame =
        document.createElement("iframe");

    frame.className =
        "rai-preview-frame";

    frame.setAttribute(
        "sandbox",
        "allow-scripts"
    );

    frame.setAttribute(
        "title",
        "RAI Web Runner Preview"
    );

    function runPreview() {
        frame.srcdoc = "";

        requestAnimationFrame(() => {
            frame.srcdoc = htmlCode;
        });

        console.log("RAI WEB RUNNER: EXECUTED");
    }

    refreshBtn.onclick = () => {
        runPreview();
    };

    fullscreenBtn.onclick = async () => {

        try {

            if (frame.requestFullscreen) {
                await frame.requestFullscreen();
            } else if (preview.requestFullscreen) {
                await preview.requestFullscreen();
            }

        } catch (error) {
            console.warn(
                "RAI FULLSCREEN ERROR:",
                error
            );
        }
    };

    closeBtn.onclick = () => {
        preview.remove();
        button.textContent = "RUN";
    };

    previewActions.appendChild(refreshBtn);
    previewActions.appendChild(fullscreenBtn);
    previewActions.appendChild(closeBtn);

    previewBar.appendChild(previewTitle);
    previewBar.appendChild(previewActions);

    preview.appendChild(previewBar);
    preview.appendChild(frame);

    workspace.appendChild(preview);

    button.textContent = "CLOSE";

    runPreview();

    setTimeout(() => {
        preview.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
        });
    }, 50);
}

function looksLikeCode(text) {

    if (!text) return false;

    /*
     * HTML DOCUMENT DETECTION
     * Dokumen HTML lengkap selalu dianggap sebagai kode.
     */
    if (
        /<!DOCTYPE\s+html[\s\S]*?<\/html\s*>/i.test(text) ||
        /<html(?:\s[^>]*)?>[\s\S]*?<\/html\s*>/i.test(text)
    ) {
        return true;
    }

    const codePatterns = [
        /function\s+\w+\s*\(/,
        /const\s+\w+\s*=/,
        /let\s+\w+\s*=/,
        /var\s+\w+\s*=/,
        /console\.log\s*\(/,
        /document\.getElementById\s*\(/,
        /=>/,
        /\{\s*return\s+/,
        /<\/?[a-z][\s\S]*>/i
    ];

    let matches = 0;

    for (const pattern of codePatterns) {
        if (pattern.test(text)) {
            matches++;
        }
    }

    return matches >= 2;
}


function highlightCode(code) {

    let html = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    html = html.replace(
        /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
        '<span class="code-comment">$1</span>'
    );

    html = html.replace(
        /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
        '<span class="code-string">$1$2$1</span>'
    );

    html = html.replace(
        /\b(const|let|var|function|return|if|else|for|while|new|class|async|await|try|catch|throw)\b/g,
        '<span class="code-keyword">$1</span>'
    );

    html = html.replace(
        /\b(\d+(?:\.\d+)?)\b/g,
        '<span class="code-number">$1</span>'
    );

    html = html.replace(
        /\b([A-Za-z_$][\w$]*)\s*(?=\()/g,
        '<span class="code-function">$1</span>'
    );

    return html;
}


function cleanRAIText(text) {

    if (!text || typeof text !== "string") {
        return text || "";
    }

    return text
        // Markdown bold / italic
        .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
        .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")

        // Heading Markdown
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")

        // Bullet Markdown
        .replace(/^\s*[-*+]\s+/gm, "• ")

        // Markdown inline code
        .replace(/`([^`\n]+)`/g, "$1")

        // Link Markdown: [teks](url) -> teks
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

        // Markdown quote
        .replace(/^\s*>\s?/gm, "")

        // Karakter kontrol yang tidak perlu
        .replace(/\u200b/g, "")
        .replace(/\u200c/g, "")
        .replace(/\u200d/g, "");
}


function renderAutoCode(text, container) {

    /*
     * HTML AUTO-DETECT
     * Jika respons berisi dokumen HTML lengkap,
     * gunakan RAI CODE WORKSPACE langsung.
     */
    if (
        /<!DOCTYPE\s+html[\s\S]*?<\/html\s*>/i.test(text) ||
        /<html(?:\s[^>]*)?>[\s\S]*?<\/html\s*>/i.test(text)
    ) {
        renderCodeBlocks(
            text.replace(
                /([\s\S]*?)(<!DOCTYPE\s+html[\s\S]*?<\/html\s*>)([\s\S]*)/i,
                "$1\\n```html\\n$2\\n```\\n$3"
            ),
            container
        );

        return;
    }

    const lines = text.split("\n");

    let codeStarted = false;
    let normalLines = [];
    let codeLines = [];

    const codeLine = line => {
        const t = line.trim();

        return (
            /^function\s+\w+\s*\(/.test(t) ||
            /^(const|let|var)\s+\w+\s*=/.test(t) ||
            /^console\.log\s*\(/.test(t) ||
            /^return\s+/.test(t) ||
            /^\}/.test(t) ||
            /^\{/.test(t) ||
            /=>/.test(t)
        );
    };

    for (const line of lines) {

        if (!codeStarted && codeLine(line)) {
            codeStarted = true;
        }

        if (codeStarted) {
            codeLines.push(line);
        } else {
            normalLines.push(line);
        }
    }

    const normalText = normalLines.join("\n").trim();
    const codeText = codeLines.join("\n").trim();

    if (normalText) {
        const normal = document.createElement("p");
        normal.textContent = normalText;
        container.appendChild(normal);
    }

    if (codeText) {

        const codeBox =
            document.createElement("div");

        codeBox.className = "code-block";

        const codeHeader =
            document.createElement("div");

        codeHeader.className =
            "code-header";

        const codeLabel =
            document.createElement("span");

        codeLabel.textContent =
            "CODE";

        const codeCopy =
            document.createElement("button");

        codeCopy.type = "button";
        codeCopy.className =
            "code-copy-btn";

        codeCopy.textContent =
            "COPY CODE";

        const code =
            document.createElement("pre");

        code.className =
            "code-content";

        code.textContent =
            codeText;

        codeCopy.onclick = async () => {

            try {

                await navigator.clipboard.writeText(
                    code.textContent
                );

                codeCopy.textContent =
                    "COPIED";

                setTimeout(() => {
                    codeCopy.textContent =
                        "COPY CODE";
                }, 1200);

            } catch (error) {

                console.error(
                    "RAI CODE COPY ERROR:",
                    error
                );

                codeCopy.textContent =
                    "FAILED";
            }
        };

        codeHeader.appendChild(codeLabel);
        codeHeader.appendChild(codeCopy);

        codeBox.appendChild(codeHeader);
        codeBox.appendChild(code);

        container.appendChild(codeBox);
    }
}

function addMessage(message, type, image = null) {

    const wrapper = document.createElement("div");
    wrapper.className = `message ${type}`;
    wrapper.dataset.messageType = type;
    wrapper.dataset.messageText = message || "";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent =
        type === "ai" ? "RAI" : "YOU";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const name = document.createElement("div");
    name.className = "message-name";
    name.textContent =
        type === "ai" ? "RAI CORE" : "OPERATOR";

    bubble.appendChild(name);

    if (image && type === "user") {
        const photo = document.createElement("img");
        photo.src = image;
        photo.alt = "Foto yang dikirim";
        photo.className = "chat-image";
        bubble.appendChild(photo);
    }

    let paragraph = null;

    if (message || type === "ai") {

        if (
            type === "ai" &&
            message &&
            (
                message.includes("```") ||
                looksLikeCode(message)
            )
        ) {
            paragraph = document.createElement("div");
            paragraph.className = "message-content";

            if (message.includes("```")) {
                renderCodeBlocks(
                    message,
                    paragraph
                );
            } else {
                renderAutoCode(
                    message,
                    paragraph
                );
            }

            bubble.appendChild(paragraph);

        } else {
            paragraph = document.createElement("p");
            paragraph.textContent = message || "";
            bubble.appendChild(paragraph);
        }
    }

    const small = document.createElement("small");
    small.textContent =
        type === "ai"
            ? "NEURAL RESPONSE // RAI"
            : "COMMAND RECEIVED";

    bubble.appendChild(small);

    if (type === "user") {
        const editBtn = document.createElement("button");

        editBtn.type = "button";
        editBtn.className = "message-action edit-btn";
        editBtn.textContent = "EDIT";
        editBtn.title = "Edit pesan";

        editBtn.onclick = function() {
            input.value = paragraph ? paragraph.textContent : message;
            input.focus();

            wrapper.remove();

            chat.scrollTop = chat.scrollHeight;
        };

        bubble.appendChild(editBtn);
    }

    if (type === "ai") {
        const copyBtn = document.createElement("button");

        copyBtn.type = "button";
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "COPY";
        copyBtn.title = "Copy jawaban RAI";

        copyBtn.onclick = async function() {
            const text = paragraph ? paragraph.textContent : "";

            if (!text) return;

            try {
                await navigator.clipboard.writeText(text);

                copyBtn.textContent = "COPIED";

                setTimeout(() => {
                    copyBtn.textContent = "COPY";
                }, 1200);

            } catch (error) {
                console.error("RAI COPY ERROR:", error);
                copyBtn.textContent = "FAILED";

                setTimeout(() => {
                    copyBtn.textContent = "COPY";
                }, 1200);
            }
        };

        bubble.appendChild(copyBtn);

        const ttsBtn = document.createElement("button");

        ttsBtn.type = "button";
        ttsBtn.className = "message-action rai-tts-btn";
        ttsBtn.textContent = "🔊";
        ttsBtn.title = "Bacakan jawaban RAI";

        ttsBtn.onclick = function() {
            const text = paragraph ? paragraph.textContent : "";

            if (!text) return;

            speakRAI(text, ttsBtn);
        };

        bubble.appendChild(ttsBtn);

        const regenerateBtn = document.createElement("button");

        regenerateBtn.type = "button";
        regenerateBtn.className = "message-action regenerate-btn";
        regenerateBtn.textContent = "REGENERATE";
        regenerateBtn.title = "Buat jawaban baru";

        regenerateBtn.onclick = function() {
            regenerateResponse(wrapper);
        };

        bubble.appendChild(regenerateBtn);

        const downloadBtn = document.createElement("button");

        downloadBtn.type = "button";
        downloadBtn.className = "message-action download-btn";
        downloadBtn.textContent = "DOWNLOAD";
        downloadBtn.title = "Download jawaban RAI";

        downloadBtn.onclick = function() {
            const text = paragraph ? paragraph.textContent : "";

            if (!text) return;

            const blob = new Blob([text], {
                type: "text/plain;charset=utf-8"
            });

            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.href = url;
            link.download = "RAI-response.txt";
            document.body.appendChild(link);
            link.click();
            link.remove();

            URL.revokeObjectURL(url);

            downloadBtn.textContent = "SAVED";

            setTimeout(() => {
                downloadBtn.textContent = "DOWNLOAD";
            }, 1200);
        };

        bubble.appendChild(downloadBtn);
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);

    chat.appendChild(wrapper);

    chat.scrollTop = chat.scrollHeight;

    return paragraph;
}


function openGallery() {
    const el = document.getElementById("galleryInput");
    if (!el) {
        alert("RAI: galleryInput tidak ditemukan");
        return;
    }
    el.click();
}

function openCamera() {
    const el = document.getElementById("cameraInput");
    if (!el) {
        alert("RAI: cameraInput tidak ditemukan");
        return;
    }
    el.click();
}

const cameraInput = document.getElementById("cameraInput");
const galleryInput = document.getElementById("galleryInput");

function loadImage(file) {
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
        alert("RAI: File harus berupa foto.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        const original = e.target.result;
        const img = new Image();

        img.onload = function() {
            const MAX_SIZE = 1600;

            let width = img.width;
            let height = img.height;

            if (width > MAX_SIZE || height > MAX_SIZE) {
                if (width > height) {
                    height = Math.round(height * MAX_SIZE / width);
                    width = MAX_SIZE;
                } else {
                    width = Math.round(width * MAX_SIZE / height);
                    height = MAX_SIZE;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");

            if (!ctx) {
                alert("RAI: Gagal memproses foto.");
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            // Kompres foto menjadi JPEG
            selectedImage = canvas.toDataURL("image/jpeg", 0.90);

            console.log(
                "RAI IMAGE COMPRESSED:",
                selectedImage.length,
                "characters"
            );

            if (!imagePreview) {
                console.error("RAI: imagePreview tidak ditemukan.");
                return;
            }

            imagePreview.innerHTML = `
                <div class="selected-image">
                    <img src="${selectedImage}" alt="Foto soal">
                    <button type="button" onclick="removeImage()" title="Hapus foto">×</button>
                </div>
            `;

            imagePreview.style.display = "block";

            if (input) {
                input.placeholder = "Foto siap dikirim...";
            }

            console.log("RAI: IMAGE PREVIEW READY");
        };

        img.onerror = function() {
            alert("RAI: Gagal memproses foto.");
        };

        img.src = original;
    };

    reader.onerror = function() {
        console.error("RAI: gagal membaca gambar.");
        alert("RAI: Gagal membaca foto.");
    };

    reader.readAsDataURL(file);
}
if (cameraInput) {
    cameraInput.addEventListener("change", function() {
        loadImage(this.files && this.files[0]);
    });
}

if (galleryInput) {
    galleryInput.addEventListener("change", function() {
        loadImage(this.files && this.files[0]);
    });
}

function removeImage() {
    selectedImage = null;

    if (cameraInput) cameraInput.value = "";
    if (galleryInput) galleryInput.value = "";

    if (imagePreview) {
        imagePreview.innerHTML = "";
        imagePreview.style.display = "none";
    }

    if (input) {
        input.placeholder = "Masukkan perintah atau pertanyaan...";
    }
}

// ==============================
// SEND / STOP CONTROL
// ==============================

// ==============================


function stopRAI() {
    stopRequested = true;

    if (currentController) {
        currentController.abort();
    }

    if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
    }

    if (typing) {
        typing.style.display = "none";
    }

    resetSendButton();
}

function resetSendButton() {
    const sendBtn = document.getElementById("sendBtn");

    if (!sendBtn) return;

    sendBtn.textContent = "SEND";
    sendBtn.classList.remove("stop-mode");
    sendBtn.title = "SEND";
    sendBtn.onclick = sendMessage;
}

function isImageGenerationRequest(text) {

    if (!text || typeof text !== "string") {
        return false;
    }

    const value =
        text.trim();

    /*
     * Harus ada kata kerja membuat/generate.
     * Jadi "jelaskan gambar ini" tidak ikut
     * masuk ke image generation.
     */
    const createVerb =
        /\b(?:buat|buatkan|bikin|bikinin|bikinkan|ciptakan|generate|hasilkan|gambarkan)\b/i;

    const imageNoun =
        /\b(?:gambar|ilustrasi|foto|poster|wallpaper|lukisan|logo|artwork)\b/i;

    return (
        createVerb.test(value) &&
        imageNoun.test(value)
    );
}


function cleanImageGenerationPrompt(text) {

    if (!text) {
        return "";
    }

    return text
        .trim()
        .replace(
            /^(?:tolong\s+)?(?:buatkan|buat|bikin|bikinin|bikinkan|ciptakan|generate|hasilkan|gambarkan)\s+(?:sebuah\s+|satu\s+)?(?:gambar|ilustrasi|foto|poster|wallpaper|lukisan|logo|artwork)\s*(?:dengan\s+)?/i,
            ""
        )
        .trim();
}


async function generateImageFromChat(
    message,
    userImage
) {
    if (userImage) {
        return false;
    }

    if (!isImageGenerationRequest(message)) {
        return false;
    }

    const prompt =
        cleanImageGenerationPrompt(message) ||
        message.trim();

    console.log(
        "RAI IMAGE INTENT:",
        prompt
    );

    typing.style.display = "block";

    const imageParagraph =
        addMessage(
            "RAI sedang membuat gambar...",
            "ai"
        );

    currentController =
        new AbortController();

    /*
     * IMAGE GENERATION MODE
     *
     * Fungsi ini hanya melakukan satu request.
     * Tidak memanggil dirinya sendiri.
     */
    try {
        const timeoutId =
            setTimeout(() => {
                if (currentController) {
                    console.warn(
                        "RAI IMAGE TIMEOUT"
                    );

                    currentController.abort();
                }
            }, 90000);

        const response =
            await fetch(
                "/api/generate-image",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        prompt
                    }),

                    signal:
                        currentController.signal
                }
            );

        clearTimeout(timeoutId);

        const responseText =
            await response.text();

        let data;

        try {
            data =
                JSON.parse(responseText);
        } catch {
            throw new Error(
                responseText ||
                `HTTP ${response.status}`
            );
        }

        if (!response.ok) {
            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );
        }

        if (
            !data.success ||
            !data.image
        ) {
            throw new Error(
                data.error ||
                "RAI tidak menerima gambar."
            );
        }

        typing.style.display =
            "none";

        if (imageParagraph) {
            const bubble =
                imageParagraph.parentElement;

            imageParagraph.innerHTML =
                "";

            imageParagraph.className =
                "message-content rai-generated-image-wrap";

            const image =
                document.createElement("img");

            image.src =
                data.image;

            image.alt =
                prompt;

            image.className =
                "rai-generated-image";

            image.loading =
                "lazy";

            imageParagraph.appendChild(
                image
            );

            const caption =
                document.createElement("div");

            caption.className =
                "rai-generated-image-caption";

            caption.textContent =
                "IMAGE GENERATED // FLUX.2";

            imageParagraph.appendChild(
                caption
            );

            if (bubble) {
                bubble.dataset.imagePrompt =
                    prompt;
            }
        }

        chat.scrollTop =
            chat.scrollHeight;

        console.log(
            "RAI IMAGE DISPLAYED:",
            data.image.length,
            "characters"
        );

        saveAIMessage(
            "[Gambar dibuat] " +
            prompt
        );

        return true;

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {
            console.log(
                "RAI IMAGE GENERATION STOPPED"
            );

            if (imageParagraph) {
                imageParagraph.textContent =
                    "RAI IMAGE GENERATION STOPPED.";
            }

            typing.style.display =
                "none";

            return true;
        }

        console.error(
            "RAI IMAGE ERROR:",
            error
        );

        typing.style.display =
            "none";

        if (imageParagraph) {
            imageParagraph.textContent =
                "RAI IMAGE ERROR: " +
                error.message;
        }

        return true;

    } finally {
        currentController = null;
    }
}

async function sendMessage() {

    console.log("RAI SEND FUNCTION CALLED");

    try {
        playRAISound("send");
    } catch (e) {
        console.error("RAI SEND INIT ERROR:", e);
    }

    console.log("RAI SEND VERSION: 20260915-STREAM-FIX");

    const message = input.value.trim();

    let imageToSend = selectedImage;

    if (
        !imageToSend &&
        selectedFile &&
        typeof selectedFile.type === "string" &&
        selectedFile.type.startsWith("image/") &&
        typeof selectedFile.data === "string"
    ) {
        imageToSend =
            "data:" +
            selectedFile.type +
            ";base64," +
            selectedFile.data;
    }

    console.log(
        "RAI SEND IMAGE:",
        imageToSend ? "ADA" : "TIDAK ADA"
    );

    if (imageToSend) {
        console.log(
            "RAI IMAGE SIZE:",
            imageToSend.length
        );
    }

    const finalMessage =
        message ||
        (imageToSend
            ? "Analisis foto ini dan jelaskan isinya dengan jelas."
            : "");

    if (!finalMessage) return;

    stopRequested = false;

    /*
     * RAI IMAGE GENERATION ROUTER
     *
     * Harus dicek SEBELUM /api/chat.
     * Kalau user meminta membuat gambar,
     * request langsung menuju FLUX.2.
     */
    if (
        !imageToSend &&
        !selectedFile &&
        isImageGenerationRequest(message)
    ) {

        console.log(
            "RAI ROUTER: IMAGE GENERATION"
        );

        const sendBtn =
            document.getElementById("sendBtn");

        if (sendBtn) {
            sendBtn.textContent = "□";
            sendBtn.classList.add("stop-mode");
            sendBtn.title = "STOP RAI";
            sendBtn.onclick = stopRAI;
        }

        addMessage(
            message,
            "user"
        );

        saveUserMessage(
            message
        );

        input.value = "";

        currentController =
            new AbortController();

        await generateImageFromChat(
            message,
            null
        );

        return;
    }

    stopRequested = false;

    const sendBtn =
        document.getElementById("sendBtn");

    if (sendBtn) {
        sendBtn.textContent = "□";
        sendBtn.classList.add("stop-mode");
        sendBtn.title = "STOP RAI";
        sendBtn.onclick = stopRAI;
    }

    console.log("RAI SEND START");

    addMessage(
        finalMessage,
        "user",
        imageToSend
    );

    saveUserMessage(
        finalMessage,
        imageToSend
    );

    input.value = "";

    if (imageToSend) {
        removeImage();
    }

    typing.style.display = "block";

    currentController =
        new AbortController();

    try {

        console.time("RAI TOTAL");
        console.time("RAI FIRST RESPONSE");

        console.log("RAI FETCH START");

        console.log(
            "RAI IMAGE SEND:",
            imageToSend
                ? `ADA (${imageToSend.length} chars)`
                : "TIDAK ADA"
        );

        console.log(
            "RAI MESSAGE SEND:",
            finalMessage
        );

        const response = await fetch(
            "/api/chat",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    message: finalMessage,
                    image: imageToSend || null,
                    file: selectedFile || null,
                    history: getMemoryContext(),
                    personality:
                        (typeof raiSettings !== "undefined"
                            ? raiSettings.personality
                            : "normal")
                }),

                signal:
                    currentController.signal
            }
        );

        console.timeEnd("RAI FIRST RESPONSE");

        console.log(
            "RAI RESPONSE:",
            response.status
        );

        if (!response.ok) {

            const errorText =
                await response.text();

            throw new Error(
                errorText ||
                `HTTP ${response.status}`
            );
        }

        if (!response.body) {
            throw new Error(
                "RAI tidak menerima stream dari server."
            );
        }

        // File sudah berhasil diterima server.
        // Bersihkan preview attachment dari area input.
        if (selectedFile) {
            removeFile();
        }

        typing.style.display = "none";

        const paragraph =
            addMessage("", "ai");

        const reader =
            response.body.getReader();

        const decoder =
            new TextDecoder();

        let receivedText = "";

        console.log(
            "RAI STREAM READER READY"
        );

        console.time("RAI FIRST CHUNK");

        while (true) {

            if (stopRequested) {

                try {
                    await reader.cancel();
                } catch {}

                break;
            }

            const {
                value,
                done
            } = await reader.read();

            if (done) {
                break;
            }

            const text =
                decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );

            if (!text) {
                continue;
            }

            receivedText += text;

            if (receivedText === text) {
                console.timeEnd("RAI FIRST CHUNK");
            }

            console.log(
                "RAI CHUNK:",
                text.length,
                "chars"
            );

            /*
             * LANGSUNG TAMPILKAN HASIL STREAM
             */
            paragraph.textContent =
                receivedText;

            chat.scrollTop =
                chat.scrollHeight;
        }

        console.timeEnd("RAI TOTAL");

        /*
         * Ambil sisa karakter decoder
         */
        const finalText =
            decoder.decode();

        if (finalText) {

            receivedText += finalText;

            paragraph.textContent =
                receivedText;
        }

        console.log(
            "RAI FRONTEND RECEIVED:",
            receivedText.length,
            "characters"
        );

        console.log(
            "RAI FRONTEND PREVIEW:",
            receivedText.slice(0, 200)
        );

        /*
         * FINAL RENDER
         * Streaming tetap tampil cepat sebagai text.
         * Setelah selesai, render ulang menggunakan
         * Code Workspace / HTML auto-detect.
         */
        if (
            receivedText &&
            !stopRequested
        ) {

            paragraph.innerHTML = "";

            if (
                receivedText.includes("```") ||
                looksLikeCode(receivedText)
            ) {

                renderAutoCode(
                    receivedText,
                    paragraph
                );

            } else {

                paragraph.textContent =
                    cleanRAIText(
                        receivedText
                    );
            }
        }

        if (
            !receivedText &&
            !stopRequested
        ) {

            paragraph.textContent =
                "RAI tidak menerima jawaban.";
        }

        if (
            receivedText &&
            !stopRequested
        ) {

            saveAIMessage(
                receivedText
            );
        }

    } catch (error) {

        if (
            error.name ===
            "AbortError"
        ) {

            console.log(
                "RAI STOPPED"
            );

            return;
        }

        console.error(
            "RAI ERROR:",
            error
        );

        typing.style.display =
            "none";

        const errorParagraph =
            addMessage(
                "RAI ERROR: " +
                error.message,
                "ai"
            );

        const errorWrapper =
            errorParagraph
                ? errorParagraph.closest(
                    ".message"
                )
                : null;

        if (errorWrapper) {

            const errorBubble =
                errorParagraph.parentElement;

            const retryBtn =
                document.createElement(
                    "button"
                );

            retryBtn.type = "button";

            retryBtn.className =
                "message-action retry-btn";

            retryBtn.textContent =
                "RETRY";

            retryBtn.title =
                "Coba kirim ulang";

            retryBtn.onclick =
                function() {

                    const previous =
                        errorWrapper
                            .previousElementSibling;

                    if (
                        previous &&
                        previous.dataset
                            .messageType ===
                            "user"
                    ) {

                        const oldMessage =
                            previous.dataset
                                .messageText ||
                            "";

                        if (oldMessage) {

                            input.value =
                                oldMessage;

                            errorWrapper.remove();

                            sendMessage();
                        }
                    }
                };

            errorBubble.appendChild(
                retryBtn
            );
        }

    } finally {

        currentController = null;

        const btn =
            document.getElementById(
                "sendBtn"
            );

        if (btn) {

            btn.textContent =
                "SEND";

            btn.classList.remove(
                "stop-mode"
            );

            btn.title = "SEND";

            btn.onclick =
                sendMessage;
        }
    }
}

function typeText(element, text) {

    return new Promise(resolve => {

        let index = 0;

        typingTimer = setInterval(() => {

            if (stopRequested) {

                clearInterval(typingTimer);
                typingTimer = null;

                resolve();
                return;
            }

            element.textContent += text[index];

            index++;

            chat.scrollTop =
                chat.scrollHeight;

            if (index >= text.length) {

                clearInterval(typingTimer);
                typingTimer = null;

                resolve();
            }

        }, 18);

    });
}

// ==============================
// UI
// ==============================

function focusChat() {

    document
        .getElementById("message")
        .focus();

    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
    });
}

function setPrompt(text) {

    input.value = text;

    input.focus();
}

function clearChat() {

    chat.innerHTML = "";

    addMessage(
        "Chat memory cleared. Neural channel ready.",
        "ai"
    );
}

function showSystem() {

    document
        .getElementById("systemModal")
        .style.display = "grid";
}

function closeSystem() {

    document
        .getElementById("systemModal")
        .style.display = "none";
}


// ==============================
// KEYBOARD
// ==============================

input.addEventListener("keydown", event => {

    if (
        event.key === "Enter" &&
        !event.shiftKey
    ) {

        event.preventDefault();

        sendMessage();
    }
});

input.addEventListener("input", () => {

    input.style.height = "43px";

    input.style.height =
        Math.min(
            input.scrollHeight,
            120
        ) + "px";
});


// ==============================
// MATRIX BACKGROUND
// ==============================

const canvas =
    document.getElementById("matrix");

const ctx =
    canvas.getContext("2d");

let width;
let height;
let columns;
let drops;

function resizeMatrix() {

    width =
        canvas.width =
        window.innerWidth;

    height =
        canvas.height =
        window.innerHeight;

    columns =
        Math.floor(width / 16);

    drops =
        Array(columns).fill(1);
}

resizeMatrix();

window.addEventListener(
    "resize",
    resizeMatrix
);

const chars =
    "01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&@<>[]{}";

function drawMatrix() {

    ctx.fillStyle =
        "rgba(1,5,3,.08)";

    ctx.fillRect(
        0,
        0,
        width,
        height
    );

    ctx.fillStyle =
        "#00ff88";

    ctx.font =
        "13px monospace";

    for (
        let i = 0;
        i < drops.length;
        i++
    ) {

        const char =
            chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];

        ctx.fillText(
            char,
            i * 16,
            drops[i] * 16
        );

        if (
            drops[i] * 16 > height &&
            Math.random() > .975
        ) {
            drops[i] = 0;
        }

        drops[i]++;
    }
}

setInterval(
    drawMatrix,
    50
);


// ==============================
// SYSTEM MONITOR
// ==============================

setInterval(() => {

    const cpu =
        Math.floor(
            20 + Math.random() * 65
        );

    const memory =
        Math.floor(
            40 + Math.random() * 45
        );

    document.getElementById(
        "cpu"
    ).textContent = cpu + "%";

    document.getElementById(
        "memory"
    ).textContent = memory + "%";

    document.getElementById(
        "cpuBar"
    ).style.width = cpu + "%";

    document.getElementById(
        "memoryBar"
    ).style.width = memory + "%";

}, 1500);



// ==============================
// GALLERY BUTTON
// ==============================


if (galleryBtn) {

    galleryBtn.addEventListener("click", openGallery);

}


window.addEventListener("error", function(e) {
    console.error("RAI JS ERROR:", e.message, e.filename, e.lineno);
});

document.addEventListener("click", function(e) {
    if (e.target && e.target.id === "sendBtn") {
    }
}, true);




/* RAI CLICK DIAGNOSTIC */
document.addEventListener("click", function(e) {
    const area = e.target.closest(".input-area");

    if (area) {
        console.log(
            "RAI INPUT CLICK:",
            "target=", e.target.id || e.target.className || e.target.tagName,
            "x=", e.clientX,
            "y=", e.clientY
        );
    }
}, true);


/* ==============================
   RAI SEND BUTTON CONTROL
   ============================== */


async function regenerateResponse(aiWrapper) {
    const previous = aiWrapper.previousElementSibling;

    if (!previous || previous.dataset.messageType !== "user") {
        console.warn("RAI: pesan user sebelumnya tidak ditemukan.");
        return;
    }

    const message = previous.dataset.messageText || "";

    if (!message) {
        console.warn("RAI: pesan kosong.");
        return;
    }

    aiWrapper.remove();

    input.value = message;

    await sendMessage();
}


/* ==============================
   RAI CHAT HISTORY UI
   ============================== */

function toggleHistory() {
    const panel = document.getElementById("historyPanel");

    if (!panel) return;

    panel.classList.toggle("active");

    if (panel.classList.contains("active")) {
        renderHistory();
    }
}

function renderHistory() {
    const list = document.getElementById("historyList");

    if (!list) return;

    list.innerHTML = "";

    if (!chatHistory.length) {
        list.innerHTML =
            '<div class="history-empty">Belum ada percakapan.</div>';
        return;
    }

    chatHistory.forEach(chatItem => {
        const item = document.createElement("button");

        item.type = "button";
        item.className = "history-item";

        const title = document.createElement("div");
        title.className = "history-item-title";
        title.textContent =
            chatItem.title || "Percakapan Baru";

        const meta = document.createElement("div");
        meta.className = "history-item-meta";

        const count = chatItem.messages
            ? chatItem.messages.length
            : 0;

        meta.textContent =
            count + " pesan";

        item.appendChild(title);
        item.appendChild(meta);

        item.onclick = () => {
            loadChatHistory(chatItem.id);
        };

        list.appendChild(item);
    });
}

function loadChatHistory(chatId) {
    const selectedChat =
        chatHistory.find(chatItem =>
            chatItem.id === chatId
        );

    if (!selectedChat) return;

    currentChatId = selectedChat.id;

    localStorage.setItem(
        RAI_CURRENT_CHAT_KEY,
        currentChatId
    );

    chat.innerHTML = "";

    selectedChat.messages.forEach(messageItem => {
        addMessage(
            messageItem.content || "",
            messageItem.role,
            messageItem.image || null
        );
    });

    const panel =
        document.getElementById("historyPanel");

    if (panel) {
        panel.classList.remove("active");
    }

    chat.scrollTop = chat.scrollHeight;
}


/* ==============================
   RAI HISTORY CONTROLS
   ============================== */

function newChat() {
    currentChatId =
        typeof crypto !== "undefined" &&
        crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now().toString(36) +
              Math.random().toString(36).slice(2);

    localStorage.setItem(
        RAI_CURRENT_CHAT_KEY,
        currentChatId
    );

    chat.innerHTML = "";

    addMessage(
        "Percakapan baru dimulai.",
        "ai"
    );

    const search =
        document.getElementById("historySearch");

    if (search) {
        search.value = "";
    }

    renderHistory();
}

function deleteChat(chatId) {
    const index =
        chatHistory.findIndex(
            chatItem => chatItem.id === chatId
        );

    if (index === -1) return;

    chatHistory.splice(index, 1);

    if (currentChatId === chatId) {
        currentChatId =
            typeof crypto !== "undefined" &&
            crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString(36) +
                  Math.random().toString(36).slice(2);

        chat.innerHTML = "";

        addMessage(
            "Percakapan baru dimulai.",
            "ai"
        );
    }

    saveChatHistory();
    renderHistory();
}

function clearAllHistory() {
    if (!chatHistory.length) return;

    const confirmed =
        confirm(
            "Hapus semua riwayat percakapan?"
        );

    if (!confirmed) return;

    chatHistory = [];

    currentChatId =
        typeof crypto !== "undefined" &&
        crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now().toString(36) +
              Math.random().toString(36).slice(2);

    localStorage.removeItem(
        RAI_HISTORY_KEY
    );

    localStorage.setItem(
        RAI_CURRENT_CHAT_KEY,
        currentChatId
    );

    chat.innerHTML = "";

    addMessage(
        "Semua riwayat telah dihapus.",
        "ai"
    );

    renderHistory();
}

function searchHistory() {
    const search =
        document.getElementById("historySearch");

    if (!search) return;

    const query =
        search.value.trim().toLowerCase();

    const list =
        document.getElementById("historyList");

    if (!list) return;

    list.innerHTML = "";

    const results = chatHistory.filter(
        chatItem => {
            const title =
                chatItem.title || "";

            const messages =
                (chatItem.messages || [])
                    .map(item =>
                        item.content || ""
                    )
                    .join(" ");

            return (
                title.toLowerCase().includes(query) ||
                messages.toLowerCase().includes(query)
            );
        }
    );

    if (!results.length) {
        list.innerHTML =
            '<div class="history-empty">Percakapan tidak ditemukan.</div>';
        return;
    }

    results.forEach(chatItem => {
        const item =
            document.createElement("div");

        item.className = "history-item";

        const title =
            document.createElement("div");

        title.className =
            "history-item-title";

        title.textContent =
            chatItem.title ||
            "Percakapan Baru";

        const meta =
            document.createElement("div");

        meta.className =
            "history-item-meta";

        meta.textContent =
            (chatItem.messages || []).length +
            " pesan";

        const openButton =
            document.createElement("button");

        openButton.type = "button";
        openButton.className =
            "history-open";

        openButton.textContent = "OPEN";

        openButton.onclick = () => {
            loadChatHistory(chatItem.id);
        };

        const deleteButton =
            document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className =
            "history-delete";

        deleteButton.textContent = "DELETE";

        deleteButton.onclick = () => {
            deleteChat(chatItem.id);
        };

        item.appendChild(title);
        item.appendChild(meta);
        item.appendChild(openButton);
        item.appendChild(deleteButton);

        list.appendChild(item);
    });
}

const historySearch =
    document.getElementById("historySearch");

if (historySearch) {
    historySearch.addEventListener(
        "input",
        searchHistory
    );
}


/* =========================================
   RAI SETTINGS
   ========================================= */

const RAI_SETTINGS_KEY = "RAI_SETTINGS_V1";

let raiSettings = {
    theme: "green",
    personality: "normal",
    fontSize: 100,
    animations: true,
    sound: false
};

function loadRAISettings() {

    try {
        const saved =
            localStorage.getItem(RAI_SETTINGS_KEY);

        if (saved) {
            raiSettings = {
                ...raiSettings,
                ...JSON.parse(saved)
            };
        }
    } catch (error) {
        console.warn("RAI SETTINGS LOAD ERROR", error);
    }

    applyRAISettings();
}

function saveRAISettings() {

    localStorage.setItem(
        RAI_SETTINGS_KEY,
        JSON.stringify(raiSettings)
    );
}

function toggleRAISettings() {

    const panel =
        document.getElementById("raiSettingsPanel");

    if (!panel) return;

    panel.hidden = !panel.hidden;
}

function applyRAISettings() {

    document.documentElement.dataset.raiTheme =
        raiSettings.theme;

    document.documentElement.style.setProperty(
        "--rai-font-scale",
        String(raiSettings.fontSize / 100)
    );

    document.documentElement.classList.toggle(
        "rai-no-animations",
        !raiSettings.animations
    );

    const theme =
        document.getElementById("raiThemeSelect");

    const personality =
        document.getElementById("raiPersonalitySelect");

    const font =
        document.getElementById("raiFontSizeValue");

    const animation =
        document.getElementById("raiAnimationToggle");

    const sound =
        document.getElementById("raiSoundToggle");

    if (theme)
        theme.value = raiSettings.theme;

    if (personality)
        personality.value = raiSettings.personality;

    if (font)
        font.textContent =
            raiSettings.fontSize + "%";

    if (animation)
        animation.textContent =
            raiSettings.animations ? "ON" : "OFF";

    if (sound)
        sound.textContent =
            raiSettings.sound ? "ON" : "OFF";
}

function changeRAIFont(direction) {

    raiSettings.fontSize += direction * 5;

    raiSettings.fontSize =
        Math.max(
            80,
            Math.min(130, raiSettings.fontSize)
        );

    saveRAISettings();
    applyRAISettings();
}

function toggleRAIAnimations() {

    raiSettings.animations =
        !raiSettings.animations;

    saveRAISettings();
    applyRAISettings();
}

function toggleRAISound() {

    raiSettings.sound =
        !raiSettings.sound;

    saveRAISettings();
    applyRAISettings();
}

function resetRAISettings() {

    raiSettings = {
        theme: "green",
        personality: "normal",
        fontSize: 100,
        animations: true,
        sound: false
    };

    saveRAISettings();
    applyRAISettings();
}

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const theme =
            document.getElementById("raiThemeSelect");

        const personality =
            document.getElementById("raiPersonalitySelect");

        if (theme) {
            theme.addEventListener(
                "change",
                () => {
                    raiSettings.theme =
                        theme.value;

                    saveRAISettings();
                    applyRAISettings();
                }
            );
        }

        if (personality) {
            personality.addEventListener(
                "change",
                () => {
                    raiSettings.personality =
                        personality.value;

                    saveRAISettings();
                }
            );
        }

        loadRAISettings();
    }
);


/* =========================================
   RAI SETTINGS SOUND ENGINE
   ========================================= */

function playRAISound(type = "click") {

    if (
        typeof raiSettings === "undefined" ||
        !raiSettings.sound
    ) {
        return;
    }

    try {

        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) return;

        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = "sine";

        if (type === "send") {
            oscillator.frequency.value = 620;
        } else if (type === "success") {
            oscillator.frequency.value = 880;
        } else {
            oscillator.frequency.value = 480;
        }

        gain.gain.setValueAtTime(
            0.0001,
            ctx.currentTime
        );

        gain.gain.exponentialRampToValueAtTime(
            0.035,
            ctx.currentTime + 0.01
        );

        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            ctx.currentTime + 0.12
        );

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.start();
        oscillator.stop(
            ctx.currentTime + 0.13
        );

        oscillator.onended = () => {
            ctx.close();
        };

    } catch (error) {
        console.warn(
            "RAI SOUND ERROR:",
            error
        );
    }
}


/* =========================================
   RAI TEXT TO SPEECH
   ========================================= */

let raiSpeaking = false;
let raiSpeechButton = null;

function speakRAI(text, button = null) {

    if (!("speechSynthesis" in window)) {
        console.warn("RAI TTS: Browser tidak mendukung.");
        return;
    }

    if (
        typeof raiSettings !== "undefined" &&
        !raiSettings.sound
    ) {
        return;
    }

    if (!text || !text.trim()) return;

    if (raiSpeaking) {
        window.speechSynthesis.cancel();
        raiSpeaking = false;

        if (raiSpeechButton) {
            raiSpeechButton.textContent = "🔊";
        }

        raiSpeechButton = null;
        return;
    }

    const cleanText = text
        .replace(/```[\s\S]*?```/g, "kode")
        .replace(/[*_#`]/g, "")
        .trim();

    if (!cleanText) return;

    const utterance =
        new SpeechSynthesisUtterance(cleanText);

    utterance.lang = "id-ID";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    raiSpeaking = true;
    raiSpeechButton = button;

    if (button) {
        button.textContent = "⏹";
    }

    utterance.onend = () => {
        raiSpeaking = false;

        if (button) {
            button.textContent = "🔊";
        }

        raiSpeechButton = null;
    };

    utterance.onerror = () => {
        raiSpeaking = false;

        if (button) {
            button.textContent = "🔊";
        }

        raiSpeechButton = null;
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}


window.addEventListener("unhandledrejection", function(e) {
    console.error("RAI UNHANDLED PROMISE:", e.reason);
});

