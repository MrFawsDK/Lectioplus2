// Flexios egne indstillinger - de hører til Flexio og ikke til Lectio, og gemmes i databasen pr. elev,
// så de følger eleven på tværs af telefon og computer.
//   GET    /api/indstillinger          elevens indstillinger (med standardværdier for dem der ikke er valgt)
//   PUT    /api/indstillinger          gem en eller flere indstillinger (kun kendte nøgler og værdier tages med)
//   DELETE /api/indstillinger          nulstil til standard
//   GET    /api/indstillinger/data     hvad Flexio har gemt om eleven (antal noter og tags)
//   DELETE /api/indstillinger/data     slet elevens noter, tags og indstillinger i Flexio ({ "bekraeft": true })

const express = require("express");
const db = require("./db");

db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        owner      TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`);

/* ---------- Hvad der kan indstilles ---------- */

// Sider man kan vælge som startside eller skjule i menuen (samme som i header.html)
const PAGES = [
    "/forside/", "/skema/", "/studieplan/", "/fravaer/", "/opgaver/", "/lektier/", "/karakter/",
    "/noter/", "/boger/", "/spoergeskema/", "/dokumenter/", "/sps/", "/beskeder/"
];

const FONTS = [
    "Roboto", "Arial", "Calibri", "Cambria", "Georgia", "Times New Roman", "Verdana",
    "Comic Sans MS", "Courier New", "Open Sans", "Lora", "Merriweather"
];

const DEFAULTS = {
    theme: "system",       // system | light | dark
    accent: "blue",        // blue | green | purple | orange | red
    textSize: "normal",    // small | normal | large
    startPage: "/forside/",
    hiddenMenu: [],        // sider der er skjult i menuen
    noteFont: "Roboto",
    noteSubject: ""        // fag der er valgt som standard til nye noter ("" = intet)
};

// Hver indstilling har en funktion der returnerer den rensede værdi, eller undefined hvis værdien ikke dur
const CHECKS = {
    theme: value => ["system", "light", "dark"].includes(value) ? value : undefined,
    accent: value => ["blue", "green", "purple", "orange", "red"].includes(value) ? value : undefined,
    textSize: value => ["small", "normal", "large"].includes(value) ? value : undefined,
    startPage: value => PAGES.includes(value) ? value : undefined,
    hiddenMenu: value => Array.isArray(value) ? [...new Set(value.filter(page => PAGES.includes(page)))] : undefined,
    noteFont: value => FONTS.includes(value) ? value : undefined,
    noteSubject: value => typeof value === "string" && value.length <= 80 ? value.trim() : undefined
};

/* ---------- Database ---------- */

// Hvem ejer indstillingerne: samme som noterne - skole + elev-id. Demo-brugere deler "demo".
function ownerOf(user) {
    if (user.demo) return "demo";
    return `${user.schoolCode}:${user.student?.studentId ?? user.student?.name}`;
}

function read(owner) {
    const row = db.prepare("SELECT data FROM settings WHERE owner = ?").get(owner);
    let saved = {};

    try {
        saved = row ? JSON.parse(row.data) : {};
    } catch {
        saved = {};
    }

    // Gamle eller ugyldige værdier erstattes af standard
    const settings = { ...DEFAULTS };
    for (const key of Object.keys(CHECKS)) {
        const value = CHECKS[key](saved[key]);
        if (value !== undefined) settings[key] = value;
    }
    return settings;
}

function write(owner, settings) {
    db.prepare(`INSERT INTO settings (owner, data, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (owner) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
        .run(owner, JSON.stringify(settings), new Date().toISOString());
}

/* ---------- Ruter ---------- */

module.exports = function settingsRouter(requireLogin) {
    const router = express.Router();
    router.use("/indstillinger", requireLogin);

    router.get("/indstillinger", (req, res) => {
        res.json({ settings: read(ownerOf(req.user)), options: { pages: PAGES, fonts: FONTS } });
    });

    router.put("/indstillinger", (req, res) => {
        const owner = ownerOf(req.user);
        const body = req.body ?? {};
        const settings = read(owner);

        for (const key of Object.keys(CHECKS)) {
            if (!(key in body)) continue;

            const value = CHECKS[key](body[key]);
            if (value === undefined) return res.status(400).json({ error: `Ugyldig værdi for ${key}` });
            settings[key] = value;
        }

        // Mindst ét menupunkt skal være tilbage, og startsiden må ikke være skjult
        if (settings.hiddenMenu.length >= PAGES.length) return res.status(400).json({ error: "Mindst ét menupunkt skal vises" });
        if (settings.hiddenMenu.includes(settings.startPage)) {
            settings.startPage = PAGES.find(page => !settings.hiddenMenu.includes(page));
        }

        write(owner, settings);
        res.json({ settings });
    });

    router.delete("/indstillinger", (req, res) => {
        db.prepare("DELETE FROM settings WHERE owner = ?").run(ownerOf(req.user));
        res.json({ settings: { ...DEFAULTS } });
    });

    router.get("/indstillinger/data", (req, res) => {
        const owner = ownerOf(req.user);
        const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner = ?`).get(owner).count;

        res.json({ notes: count("notes"), tags: count("tags") });
    });

    // Sletter kun Flexios egne data - Lectio berøres ikke
    router.delete("/indstillinger/data", (req, res) => {
        if (req.body?.bekraeft !== true) return res.status(400).json({ error: "Bekræft, at du vil slette dine data" });

        const owner = ownerOf(req.user);
        db.prepare("DELETE FROM note_recipients WHERE note_id IN (SELECT id FROM notes WHERE owner = ?)").run(owner);
        db.prepare("DELETE FROM notes WHERE owner = ?").run(owner);
        db.prepare("DELETE FROM tags WHERE owner = ?").run(owner);
        db.prepare("DELETE FROM settings WHERE owner = ?").run(owner);

        res.json({ ok: true });
    });

    return router;
};
