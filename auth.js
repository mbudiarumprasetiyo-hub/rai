const session = require("express-session");
const { google } = require("googleapis");

function setupAuth(app) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    }));

    app.get("/auth/google", (req, res) => {
        const url = oauth2Client.generateAuthUrl({
            access_type: "offline",
            scope: [
                "openid",
                "email",
                "profile"
            ],
            prompt: "select_account"
        });

        res.redirect(url);
    });

    app.get("/auth/google/callback", async (req, res) => {
        try {
            const { code } = req.query;

            if (!code) {
                return res.status(400).send("Google login gagal: authorization code tidak ditemukan.");
            }

            const { tokens } =
                await oauth2Client.getToken(code);

            oauth2Client.setCredentials(tokens);

            const oauth2 =
                google.oauth2({
                    auth: oauth2Client,
                    version: "v2"
                });

            const { data: user } =
                await oauth2.userinfo.get();

            req.session.user = {
                id: user.id,
                name: user.name || "",
                email: user.email || "",
                picture: user.picture || ""
            };

            console.log(
                "RAI GOOGLE LOGIN:",
                user.email
            );

            res.redirect("/");
        } catch (error) {
            console.error(
                "RAI GOOGLE LOGIN ERROR:",
                error
            );

            res.status(500).send(
                "Login Google gagal. Cek terminal RAI."
            );
        }
    });

    app.get("/api/auth/me", (req, res) => {
        if (!req.session.user) {
            return res.json({
                loggedIn: false
            });
        }

        res.json({
            loggedIn: true,
            user: req.session.user
        });
    });

    app.post("/auth/logout", (req, res) => {
        req.session.destroy(() => {
            res.json({
                success: true
            });
        });
    });

    function requireLogin(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({
                error: "LOGIN_REQUIRED",
                message:
                    "Login dengan Google untuk menggunakan fitur ini."
            });
        }

        next();
    }

    return {
        requireLogin
    };
}

module.exports = {
    setupAuth
};
