// Flexios API:
//   GET  /api/schools                  alle Lectio-skoler
//   POST /api/login                    { schoolCode, cookie } eller { demo: true }
//   POST /api/logout
//   GET  /api/me                       hvem er logget ind
//   GET  /api/skema?week=40&year=2026  skemaet for en uge
//   GET  /api/opgaver                  opgaver
//   GET  /api/karakterer               karakterblad
//   Noter, tags og fag: se noter.js (gemmes i en database)
//
// Lectio-cookien gemmes kun her i serverens hukommelse. Browseren får kun et tilfældigt sessions-id.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const lectio = require("./lectio");

const router = express.Router();
router.use(express.json());

/* ---------- Sessioner ---------- */

const sessions = new Map(); // sessions-id -> { schoolCode, cookie, student, demo }

function getSession(req) {
    const id = (req.headers.cookie ?? "").match(/flexio_session=([a-f0-9]+)/)?.[1];
    return id ? sessions.get(id) : null;
}

function startSession(res, session) {
    const id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, session);
    res.cookie("flexio_session", id, { httpOnly: true, sameSite: "lax" });
}

function requireLogin(req, res, next) {
    req.user = getSession(req);
    if (!req.user) return res.status(401).json({ error: "Du er ikke logget ind" });
    next();
}

// Lectio-fejl -> svar
function lectioError(res, error) {
    if (error instanceof lectio.NotLoggedInError) {
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
    const id = (req.headers.cookie ?? "").match(/flexio_session=([a-f0-9]+)/)?.[1];
    sessions.delete(id);
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

/* ---------- Noter ---------- */

router.use(require("./noter")(requireLogin));

module.exports = router;
