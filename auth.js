const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { promisify } = require("util");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const scrypt = promisify(crypto.scrypt);

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const attempts = new Map();

let writeQueue = Promise.resolve();

async function readUsers() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        const raw = await fs.readFile(USERS_FILE, "utf8");
        const users = JSON.parse(raw);
        return Array.isArray(users) ? users : [];
    } catch (error) {
        if (error.code === "ENOENT") {
            await fs.writeFile(
                USERS_FILE,
                "[]",
                { mode: 0o600 }
            );
            return [];
        }

        throw error;
    }
}

function saveUsers(users) {
    const operation = writeQueue.catch(() => {}).then(async () => {
        await fs.mkdir(DATA_DIR, { recursive: true });

        const tempFile =
            USERS_FILE + "." + crypto.randomUUID() + ".tmp";

        try {
            await fs.writeFile(
                tempFile,
                JSON.stringify(users, null, 2),
                { mode: 0o600 }
            );

            await fs.rename(tempFile, USERS_FILE);
        } catch (error) {
            await fs.unlink(tempFile).catch(() => {});
            throw error;
        }
    });

    writeQueue = operation;
    return operation;
}

async function hashPassword(password, salt) {
    const derived = await scrypt(
        password,
        salt,
        64
    );

    return derived.toString("hex");
}

async function verifyPassword(password, user) {
    try {
        const actual = await hashPassword(
            password,
            Buffer.from(user.salt, "hex")
        );

        const expected = Buffer.from(
            user.passwordHash,
            "hex"
        );

        const actualBuffer = Buffer.from(actual, "hex");

        return (
            expected.length === actualBuffer.length &&
            crypto.timingSafeEqual(expected, actualBuffer)
        );
    } catch {
        return false;
    }
}

function getClientKey(req) {
    return String(req.ip || "unknown");
}

function checkRateLimit(req, res, next) {
    const key = getClientKey(req);
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 10;

    let entry = attempts.get(key);

    if (!entry || now - entry.startedAt > windowMs) {
        entry = {
            startedAt: now,
            count: 0
        };
    }

    if (entry.count >= maxAttempts) {
        return res.status(429).json({
            success: false,
            error: "TOO_MANY_ATTEMPTS",
            message: "Terlalu banyak percobaan. Coba lagi 15 menit kemudian."
        });
    }

    entry.count += 1;
    attempts.set(key, entry);

    next();
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function setupAuth(app) {
    // Pastikan JSON body dibaca sebelum route registrasi dan login.
    app.use(require("express").json({ limit: "30mb" }));

    if (!process.env.SESSION_SECRET ||
        process.env.SESSION_SECRET.length < 32) {
        throw new Error(
            "SESSION_SECRET wajib tersedia dan minimal 32 karakter."
        );
    }

    app.use(session({
        name: "rai.sid.v3",
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: new FileStore({
            path: path.join(__dirname, "sessions"),
            ttl: 7 * 24 * 60 * 60,
            retries: 1
        }),
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: SESSION_AGE
        }
    }));

    app.post(
        "/api/auth/register",
        checkRateLimit,
        async (req, res) => {
            try {
                const name = String(req.body?.name || "").trim();
                const email = String(req.body?.email || "")
                    .trim()
                    .toLowerCase();
                const password = req.body?.password;

                if (
                    name.length < 2 ||
                    name.length > 40 ||
                    !/^[\p{L}\p{N} ._'-]+$/u.test(name)
                ) {
                    return res.status(400).json({
                        success: false,
                        error: "INVALID_NAME",
                        message: "Nama harus terdiri dari 2–40 karakter."
                    });
                }

                if (
                    email.length > 254 ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                ) {
                    return res.status(400).json({
                        success: false,
                        error: "INVALID_EMAIL",
                        message: "Format email tidak valid."
                    });
                }

                if (
                    typeof password !== "string" ||
                    password.length < PASSWORD_MIN ||
                    password.length > PASSWORD_MAX
                ) {
                    return res.status(400).json({
                        success: false,
                        error: "INVALID_PASSWORD",
                        message: "Password harus terdiri dari 8–128 karakter."
                    });
                }

                const users = await readUsers();

                if (users.some(user => user.email === email)) {
                    return res.status(409).json({
                        success: false,
                        error: "EMAIL_EXISTS",
                        message: "Email sudah terdaftar."
                    });
                }

                const salt = crypto.randomBytes(16);
                const passwordHash = await hashPassword(
                    password,
                    salt
                );

                const user = {
                    id: crypto.randomUUID(),
                    name,
                    email,
                    salt: salt.toString("hex"),
                    passwordHash,
                    createdAt: new Date().toISOString()
                };

                users.push(user);
                await saveUsers(users);

                await regenerateSession(req);

                req.session.user = {
                    id: user.id,
                    name: user.name,
                    email: user.email
                };

                await saveSession(req);

                console.log("RAI ACCOUNT REGISTERED:", email);

                return res.status(201).json({
                    success: true,
                    message: "Registrasi berhasil.",
                    user: req.session.user
                });

            } catch (error) {
                console.error("RAI REGISTER ERROR:", error);

                return res.status(500).json({
                    success: false,
                    error: "REGISTER_FAILED",
                    message: "Registrasi gagal. Silakan coba lagi."
                });
            }
        }
    );

    app.post(
        "/api/auth/login",
        checkRateLimit,
        async (req, res) => {
            try {
                const email = String(req.body?.email || "")
                    .trim()
                    .toLowerCase();
                const password = req.body?.password;

                if (
                    !email ||
                    typeof password !== "string" ||
                    password.length > PASSWORD_MAX
                ) {
                    return res.status(400).json({
                        success: false,
                        error: "INVALID_INPUT",
                        message: "Email atau password tidak valid."
                    });
                }

                const users = await readUsers();

                const user = users.find(
                    item => item.email === email
                );

                if (
                    !user ||
                    !(await verifyPassword(password, user))
                ) {
                    return res.status(401).json({
                        success: false,
                        error: "INVALID_CREDENTIALS",
                        message: "Email atau password salah."
                    });
                }

                await regenerateSession(req);

                req.session.user = {
                    id: user.id,
                    name: user.name,
                    email: user.email
                };

                await saveSession(req);

                console.log("RAI ACCOUNT LOGIN:", email);

                return res.json({
                    success: true,
                    message: "Login berhasil.",
                    user: req.session.user
                });

            } catch (error) {
                console.error("RAI LOGIN ERROR:", error);

                return res.status(500).json({
                    success: false,
                    error: "LOGIN_FAILED",
                    message: "Login gagal. Silakan coba lagi."
                });
            }
        }
    );

    app.get("/api/auth/me", (req, res) => {
        if (!req.session.user) {
            return res.json({
                loggedIn: false
            });
        }

        return res.json({
            loggedIn: true,
            user: req.session.user
        });
    });

    app.post("/auth/logout", (req, res) => {
        req.session.destroy(error => {
            if (error) {
                return res.status(500).json({
                    success: false,
                    message: "Logout gagal."
                });
            }

            res.clearCookie("rai.sid.v3", {
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production"
            });

            return res.json({
                success: true
            });
        });
    });

    function requireLogin(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({
                error: "LOGIN_REQUIRED",
                message: "Login ke akun RAI untuk menggunakan fitur ini."
            });
        }

        next();
    }

    return { requireLogin };
}

module.exports = { setupAuth };
