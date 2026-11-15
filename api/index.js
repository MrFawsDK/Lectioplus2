// Flexios API:
//   GET  /api/schools                  alle Lectio-skoler
//   POST /api/login                    { schoolCode, cookie } eller { demo: true }
//   POST /api/logout
//   GET  /api/me                       hvem er logget ind
//   GET  /api/skema?week=40&year=2026  skemaet for en uge
//   GET  /api/opgaver                  opgaver
//   GET  /api/karakterer               karakterblad
//   GET  /api/fravaer                  fravær pr. hold
//   GET  /api/beskeder?mappe=          beskeder og mapper;  GET /api/beskeder/:id  en besked med svar (beskeder.js)
//   GET  /api/dokumenter?mappe=        dokumenter og mapper (beskeder.js)
//   GET  /api/lektier                  lektier;  GET /api/studieplan  forløb pr. fag (lektier.js)
//   Noter, tags, fag og deling af noter: se noter.js (gemmes i en database)
//
// Lectio-cookien gemmes på serveren i databasen (sessions), så man er logget ind efter en genstart.
// Browseren får kun et tilfældigt sessions-id, og databasen kender kun id'ets hash.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const db = require("./db");
const lectio = require("./lectio");
const post = require("./beskeder");
const plan = require("./lektier");
const pages = require("./sider");
const profile = require("./profil");

const router = express.Router();
router.use(express.json());

/* ---------- Sessioner ---------- */

db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id        TEXT PRIMARY KEY,
        data      TEXT NOT NULL,
        last_seen INTEGER NOT NULL
    );
`);

const SESSION_DAYS = 30; // ubrugte sessioner slettes efter 30 dage
const DAY = 24 * 60 * 60 * 1000;

const sessionSql = {
    get: db.prepare("SELECT data, last_seen FROM sessions WHERE id = ?"),
    insert: db.prepare("INSERT INTO sessions (id, data, last_seen) VALUES (?, ?, ?)"),
    touch: db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?"),
    delete: db.prepare("DELETE FROM sessions WHERE id = ?"),
    deleteOld: db.prepare("DELETE FROM sessions WHERE last_seen < ?")
};

// Sessioner der er i brug, holdes også i hukommelsen - der ligger hold og elever fra Lectio i en time
const sessions = new Map(); // hash af sessions-id -> { schoolCode, cookie, student, demo }

function hashId(id) {
    return crypto.createHash("sha256").update(id).digest("hex");
}

function sessionId(req) {
    return (req.headers.cookie ?? "").match(/flexio_session=([a-f0-9]+)/)?.[1];
}

function getSession(req) {
    const id = sessionId(req);
    if (!id) return null;

    const key = hashId(id);
    if (sessions.has(key)) return sessions.get(key);

    const row = sessionSql.get.get(key);
    if (!row || row.last_seen < Date.now() - SESSION_DAYS * DAY) return null;

    const session = JSON.parse(row.data);
    sessions.set(key, session);
    sessionSql.touch.run(Date.now(), key);
    return session;
}

function startSession(res, session) {
    const id = crypto.randomBytes(32).toString("hex");
    const { schoolCode, cookie, student, demo } = session;

    sessionSql.deleteOld.run(Date.now() - SESSION_DAYS * DAY);
    sessionSql.insert.run(hashId(id), JSON.stringify({ schoolCode, cookie, student, demo }), Date.now());
    sessions.set(hashId(id), session);
    res.cookie("flexio_session", id, { httpOnly: true, sameSite: "lax", maxAge: SESSION_DAYS * DAY });
}

function requireLogin(req, res, next) {
    req.user = getSession(req);
    if (!req.user) return res.status(401).json({ error: "Du er ikke logget ind" });
    next();
}

// Lectio-fejl -> svar
function lectioError(res, error) {
    if (error instanceof lectio.NotLoggedInError) {
        // Sessionen er ubrugelig - slet den, så login-siden ikke tror, man stadig er logget ind
        const id = sessionId(res.req);
        if (id) {
            sessions.delete(hashId(id));
            sessionSql.delete.run(hashId(id));
        }
        res.clearCookie("flexio_session");
        return res.status(401).json({ error: "Din Lectio-session er udløbet. Log ind igen.", code: "not_authenticated" });
    }
    console.error(error);
    res.status(502).json({ error: "Kunne ikke hente data fra Lectio" });
}

// Demo-login bruger JSON-filerne i public/
function demoData(file) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8"));
}

/* ---------- Login ---------- */

router.get("/schools", async (req, res) => {
    try {
        res.json({ schools: await lectio.getSchools() });
    } catch (error) {
        lectioError(res, error);
    }
});

router.post("/login", async (req, res) => {
    const { schoolCode, cookie, demo } = req.body ?? {};

    if (demo === true) {
        const student = { name: "Demo-elev", className: "Demo", schoolName: "Demo-skole" };
        startSession(res, { demo: true, student });
        return res.json({ student });
    }

    if (!/^\d+$/.test(schoolCode ?? "")) return res.status(400).json({ error: "Vælg en skole" });
    if (!cookie || /[\r\n]/.test(cookie)) return res.status(400).json({ error: "Indsæt din Lectio-cookie" });

    const user = { schoolCode, cookie: cookie.replace(/^\s*cookie:\s*/i, "").trim() };

    try {
        // Virker cookien, kan vi se elevens forside
        user.student = await lectio.getStudent(user);
        startSession(res, user);
        res.json({ student: user.student });
    } catch (error) {
        if (error instanceof lectio.NotLoggedInError) {
            return res.status(401).json({ error: "Cookien virker ikke. Tjek at du er logget ind på Lectio og har valgt den rigtige skole." });
        }
        lectioError(res, error);
    }
});

router.post("/logout", (req, res) => {
    const id = sessionId(req);
    if (id) {
        sessions.delete(hashId(id));
        sessionSql.delete.run(hashId(id));
    }
    res.clearCookie("flexio_session");
    res.json({ ok: true });
});

router.get("/me", requireLogin, (req, res) => {
    res.json({ student: req.user.student, demo: Boolean(req.user.demo) });
});

/* ---------- Data ---------- */

router.get("/skema", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("skema/skema.json"));

    try {
        res.json(await lectio.getSchedule(req.user, Number(req.query.week), Number(req.query.year)));
    } catch (error) {
        lectioError(res, error);
    }
});

router.get("/opgaver", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("opgaver/opgaver.json"));

    try {
        res.json(await lectio.getAssignments(req.user));
    } catch (error) {
        lectioError(res, error);
    }
});

router.get("/karakterer", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("karakter/karakter.json"));
    if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

    try {
        res.json(await lectio.getGrades(req.user));
    } catch (error) {
        lectioError(res, error);
    }
});

router.get("/fravaer", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("fravaer/fravaer.json"));
    if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

    try {
        res.json(await lectio.getAbsence(req.user));
    } catch (error) {
        if (error.expose) return res.status(502).json({ error: error.message });
        lectioError(res, error);
    }
});

router.get("/beskeder", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("beskeder/beskeder.json"));

    try {
        res.json(await post.getMessages(req.user, req.query.mappe));
    } catch (error) {
        lectioError(res, error);
    }
});

router.get("/beskeder/:id", requireLogin, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Ugyldig besked" });
    if (req.user.demo) return res.json(demoData("beskeder/besked.json"));

    try {
        res.json(await post.getMessage(req.user, req.params.id));
    } catch (error) {
        if (error.expose) return res.status(502).json({ error: error.message });
        lectioError(res, error);
    }
});

router.get("/dokumenter", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("dokumenter/dokumenter.json"));
    if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

    try {
        res.json(await post.getDocuments(req.user, req.query.mappe));
    } catch (error) {
        lectioError(res, error);
    }
});

router.get("/lektier", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("lektier/lektier.json"));
    if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

    try {
        res.json(await plan.getHomework(req.user));
    } catch (error) {
        if (error.expose) return res.status(502).json({ error: error.message });
        lectioError(res, error);
    }
});

router.get("/studieplan", requireLogin, async (req, res) => {
    if (req.user.demo) return res.json(demoData("studieplan/studieplan.json"));
    if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

    try {
        res.json(await plan.getStudyPlan(req.user));
    } catch (error) {
        lectioError(res, error);
    }
});

// Profilbilledet hentes fra Lectio med elevens cookie (demo-brugeren har intet billede)
router.get("/profil/billede", requireLogin, async (req, res) => {
    if (req.user.demo) return res.status(404).end();

    try {
        const image = await profile.getProfileImage(req.user);
        if (!image) return res.status(404).end();

        res.set("Cache-Control", "private, max-age=3600").type(image.type).send(image.buffer);
    } catch (error) {
        if (error instanceof lectio.NotLoggedInError) return lectioError(res, error);
        console.error(error);
        res.status(404).end();
    }
});

// Bøger, spørgeskemaer og SPS læses generisk fra Lectio (sider.js)
for (const [route, load, demo] of [
    ["boger", user => pages.getBooks(user), "boger/boger.json"],
    ["spoergeskema", user => pages.getSurveys(user), "spoergeskema/spoergeskema.json"],
    ["sps", user => pages.getSps(user), "sps/sps.json"]
]) {
    router.get(`/${route}`, requireLogin, async (req, res) => {
        if (req.user.demo) return res.json(demoData(demo));
        if (!req.user.student?.studentId) return res.status(502).json({ error: "Kunne ikke finde dit elev-id i Lectio. Log ud og ind igen." });

        try {
            res.json(await load(req.user));
        } catch (error) {
            if (error.expose) return res.status(502).json({ error: error.message });
            lectioError(res, error);
        }
    });
}

/* ---------- Noter ---------- */

router.use(require("./noter")(requireLogin));

module.exports = router;
