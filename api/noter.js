// Noter og tags i en SQLite-database (data/flexio.db). Hver elev har sine egne noter.
//   GET    /api/noter               alle noter og tags
//   POST   /api/noter               ny note
//   PUT    /api/noter/:id           gem note (bruges af autogem)
//   DELETE /api/noter/:id
//   POST   /api/noter/import        noter fra browseren (fra før databasen) - kun hvis eleven ingen noter har
//   POST   /api/tags, PUT /api/tags/:id, DELETE /api/tags/:id
//   GET    /api/fag                 fag fra elevens hold i Lectio

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const lectio = require("./lectio");

/* ---------- Database ---------- */

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "flexio.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
        id           TEXT PRIMARY KEY,
        owner        TEXT NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        subject      TEXT NOT NULL DEFAULT '',
        date         TEXT NOT NULL,
        lesson_date  TEXT,
        lesson_start TEXT,
        tags         TEXT NOT NULL DEFAULT '[]',
        content      TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_owner ON notes (owner);

    CREATE TABLE IF NOT EXISTS tags (
        id    TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name  TEXT NOT NULL,
        color TEXT NOT NULL,
        icon  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tags_owner ON tags (owner);
`);

const sql = {
    notes: db.prepare("SELECT * FROM notes WHERE owner = ? ORDER BY updated_at DESC"),
    note: db.prepare("SELECT * FROM notes WHERE id = ? AND owner = ?"),
    insertNote: db.prepare(`INSERT INTO notes (id, owner, title, subject, date, lesson_date, lesson_start, tags, content, created_at, updated_at)
                            VALUES (:id, :owner, :title, :subject, :date, :lesson_date, :lesson_start, :tags, :content, :created_at, :updated_at)`),
    updateNote: db.prepare(`UPDATE notes SET title = :title, subject = :subject, date = :date, lesson_date = :lesson_date,
                            lesson_start = :lesson_start, tags = :tags, content = :content, updated_at = :updated_at
                            WHERE id = :id AND owner = :owner`),
    deleteNote: db.prepare("DELETE FROM notes WHERE id = ? AND owner = ?"),
    countNotes: db.prepare("SELECT COUNT(*) AS count FROM notes WHERE owner = ?"),

    tags: db.prepare("SELECT id, name, color, icon FROM tags WHERE owner = ? ORDER BY name"),
    tag: db.prepare("SELECT id FROM tags WHERE id = ? AND owner = ?"),
    insertTag: db.prepare("INSERT INTO tags (id, owner, name, color, icon) VALUES (?, ?, ?, ?, ?)"),
    updateTag: db.prepare("UPDATE tags SET name = ?, color = ?, icon = ? WHERE id = ? AND owner = ?"),
    deleteTag: db.prepare("DELETE FROM tags WHERE id = ? AND owner = ?"),
    countTags: db.prepare("SELECT COUNT(*) AS count FROM tags WHERE owner = ?"),
    moveNotes: db.prepare("UPDATE notes SET owner = ? WHERE owner = ?"),
    moveTags: db.prepare("UPDATE tags SET owner = ? WHERE owner = ?")
};

/* ---------- Hjælpere ---------- */

// Hvem ejer noterne: skole + elev-id fra Lectio. Demo-brugere deler "demo".
function ownerOf(user) {
    if (user.demo) return "demo";

    const { studentId, name } = user.student ?? {};
    const owner = `${user.schoolCode}:${studentId ?? name}`;

    // Tidligere blev noter gemt under elevens navn - de flyttes over til elev-id'et (én gang pr. session)
    if (studentId && !user.notesMoved) {
        sql.moveNotes.run(owner, `${user.schoolCode}:${name}`);
        sql.moveTags.run(owner, `${user.schoolCode}:${name}`);
        user.notesMoved = true;
    }

    return owner;
}

function newId() {
    return crypto.randomUUID();
}

function now() {
    return new Date().toISOString();
}

function text(value, max) {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function isDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value) {
    return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

// Række fra databasen -> note til browseren
function toNote(row) {
    return {
        id: row.id,
        title: row.title,
        subject: row.subject,
        date: row.date,
        lesson: row.lesson_date ? { date: row.lesson_date, start: row.lesson_start } : undefined,
        tags: JSON.parse(row.tags),
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// Data fra browseren -> felter til databasen (kun gyldige værdier)
function noteFields(body, owner) {
    const lesson = body.lesson && isDate(body.lesson.date) && isTime(body.lesson.start) ? body.lesson : null;
    const tagIds = Array.isArray(body.tags) ? body.tags.filter(id => typeof id === "string" && sql.tag.get(id, owner)) : [];

    return {
        title: text(body.title, 200),
        subject: text(body.subject, 100),
        date: isDate(body.date) ? body.date : now().slice(0, 10),
        lesson_date: lesson?.date ?? null,
        lesson_start: lesson?.start ?? null,
        tags: JSON.stringify([...new Set(tagIds)]),
        content: text(body.content, 500000)
    };
}

const TAG_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"];

function tagFields(body) {
    const name = text(body.name, 24).trim();
    const color = TAG_COLORS.includes(body.color) ? body.color : "blue";
    const icon = typeof body.icon === "string" && /^[a-z_]{1,40}$/.test(body.icon) ? body.icon : "label";
    return { name, color, icon };
}

// Demo-brugeren starter med eksempelnoterne fra public/noter/noter.json
function seedDemo() {
    if (sql.countNotes.get("demo").count > 0 || sql.countTags.get("demo").count > 0) return;

    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "noter", "noter.json"), "utf8"));
    importData("demo", seed);
}

// Plain tekst (fra ældre noter) -> afsnit i HTML
function textToHtml(value) {
    const escape = part => part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return String(value ?? "").split(/\n{2,}/).map(part => `<p>${escape(part).replace(/\n/g, "<br>")}</p>`).join("");
}

// Indsæt noter og tags fra browseren / eksempelfilen. Gamle id'er får nye, så de ikke støder sammen.
function importData(owner, data) {
    const tagIdMap = new Map();

    for (const tag of Array.isArray(data.tags) ? data.tags : []) {
        const fields = tagFields(tag);
        if (!fields.name) continue;

        const id = newId();
        sql.insertTag.run(id, owner, fields.name, fields.color, fields.icon);
        tagIdMap.set(tag.id, id);
    }

    for (const note of Array.isArray(data.notes) ? data.notes : []) {
        const content = note.format === "html" ? note.content : textToHtml(note.content);
        const fields = noteFields({ ...note, content, tags: (note.tags ?? []).map(id => tagIdMap.get(id)) }, owner);
        const time = now();
        sql.insertNote.run({ id: newId(), owner, ...fields, created_at: time, updated_at: time });
    }
}

/* ---------- Fag fra Lectio ---------- */

function weekOf(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return { week: Math.ceil(((target - yearStart) / 86400000 + 1) / 7), year: target.getUTCFullYear() };
}

// Holdene fra elevens skema i denne og de 3 forrige uger (gemmes på sessionen i en time)
async function lectioSubjects(user) {
    if (user.demo) {
        const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "skema", "skema.json"), "utf8"));
        return demo.lessons.map(lesson => lesson.subject);
    }

    if (user.subjects && Date.now() - user.subjects.time < 60 * 60 * 1000) return user.subjects.list;

    const teams = new Set();
    for (let weeksBack = 0; weeksBack < 4; weeksBack++) {
        const { week, year } = weekOf(new Date(Date.now() - weeksBack * 7 * 86400000));
        const { lessons } = await lectio.getSchedule(user, week, year);
        lessons.forEach(lesson => {
            if (lesson.team && !lesson.team.startsWith("Alle ")) teams.add(lesson.team);
        });
    }

    user.subjects = { time: Date.now(), list: [...teams] };
    return user.subjects.list;
}

/* ---------- Ruter ---------- */

module.exports = function noterRouter(requireLogin) {
    const router = express.Router();
    router.use(["/noter", "/tags", "/fag"], requireLogin);

    router.get("/noter", (req, res) => {
        const owner = ownerOf(req.user);
        if (owner === "demo") seedDemo();

        res.json({
            notes: sql.notes.all(owner).map(toNote),
            tags: sql.tags.all(owner)
        });
    });

    router.post("/noter", (req, res) => {
        const owner = ownerOf(req.user);
        const time = now();
        const id = newId();

        sql.insertNote.run({ id, owner, ...noteFields(req.body ?? {}, owner), created_at: time, updated_at: time });
        res.status(201).json(toNote(sql.note.get(id, owner)));
    });

    router.put("/noter/:id", (req, res) => {
        const owner = ownerOf(req.user);
        if (!sql.note.get(req.params.id, owner)) return res.status(404).json({ error: "Noten findes ikke" });

        sql.updateNote.run({ id: req.params.id, owner, ...noteFields(req.body ?? {}, owner), updated_at: now() });
        res.json(toNote(sql.note.get(req.params.id, owner)));
    });

    router.delete("/noter/:id", (req, res) => {
        sql.deleteNote.run(req.params.id, ownerOf(req.user));
        res.json({ ok: true });
    });

    router.post("/noter/import", (req, res) => {
        const owner = ownerOf(req.user);
        if (sql.countNotes.get(owner).count > 0 || sql.countTags.get(owner).count > 0) {
            return res.status(409).json({ error: "Der er allerede noter i databasen" });
        }

        importData(owner, req.body ?? {});
        res.json({ notes: sql.notes.all(owner).map(toNote), tags: sql.tags.all(owner) });
    });

    router.post("/tags", (req, res) => {
        const fields = tagFields(req.body ?? {});
        if (!fields.name) return res.status(400).json({ error: "Skriv et navn" });

        const id = newId();
        sql.insertTag.run(id, ownerOf(req.user), fields.name, fields.color, fields.icon);
        res.status(201).json({ id, ...fields });
    });

    router.put("/tags/:id", (req, res) => {
        const owner = ownerOf(req.user);
        const fields = tagFields(req.body ?? {});
        if (!fields.name) return res.status(400).json({ error: "Skriv et navn" });
        if (!sql.tag.get(req.params.id, owner)) return res.status(404).json({ error: "Tagget findes ikke" });

        sql.updateTag.run(fields.name, fields.color, fields.icon, req.params.id, owner);
        res.json({ id: req.params.id, ...fields });
    });

    // Sletter tagget og fjerner det fra noterne
    router.delete("/tags/:id", (req, res) => {
        const owner = ownerOf(req.user);
        sql.deleteTag.run(req.params.id, owner);

        for (const row of sql.notes.all(owner)) {
            const tagIds = JSON.parse(row.tags);
            if (tagIds.includes(req.params.id)) {
                sql.updateNote.run({
                    id: row.id,
                    owner,
                    title: row.title,
                    subject: row.subject,
                    date: row.date,
                    lesson_date: row.lesson_date,
                    lesson_start: row.lesson_start,
                    tags: JSON.stringify(tagIds.filter(id => id !== req.params.id)),
                    content: row.content,
                    updated_at: row.updated_at
                });
            }
        }

        res.json({ ok: true });
    });

    router.get("/fag", async (req, res) => {
        const owner = ownerOf(req.user);
        const used = sql.notes.all(owner).map(row => row.subject);

        let fromLectio = [];
        try {
            fromLectio = await lectioSubjects(req.user);
        } catch (error) {
            if (error instanceof lectio.NotLoggedInError) {
                return res.status(401).json({ error: "Din Lectio-session er udløbet. Log ind igen.", code: "not_authenticated" });
            }
            console.error(error);
        }

        const subjects = [...new Set([...fromLectio, ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b, "da"));
        res.json({ subjects });
    });

    return router;
};
