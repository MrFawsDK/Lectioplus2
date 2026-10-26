// Noter og tags i en SQLite-database (data/flexio.db). Hver elev har sine egne noter.
//   GET    /api/noter               alle noter og tags
//   POST   /api/noter               ny note (browseren må selv vælge id'et, så et gem der sendes to gange ikke giver to noter)
//   PUT    /api/noter/:id           gem note (bruges af autogem)
//   DELETE /api/noter/:id
//   POST   /api/noter/import        noter fra browseren (fra før databasen) - kun hvis eleven ingen noter har
//   GET    /api/brugere?q=anna      søg efter andre Flexio-brugere på samme skole (dem man kan dele med)
//   PUT    /api/noter/:id/modtagere del noten med andre brugere (hele listen sendes)
//   GET    /api/hold                elevens hold (fra skemaet)
//   GET    /api/hold/:id/elever     eleverne på et af elevens hold
//   GET    /api/delt-med-mig        noter andre har delt med eleven eller elevens hold
//   GET    /api/delt-med-mig/:id    en af dem
//   POST   /api/delt-med-mig/:id/kopi gem en kopi i egne noter
//   POST   /api/tags, PUT /api/tags/:id, DELETE /api/tags/:id
//   GET    /api/fag                 fag fra elevens hold i Lectio

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const lectio = require("./lectio");

/* ---------- Database ---------- */

// DATA_DIR kan sættes, så databasen ligger uden for koden (fx et Docker-volume)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
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

// Deling kom til senere - ældre databaser får kolonnerne her
const noteColumns = db.prepare("PRAGMA table_info(notes)").all().map(column => column.name);
if (!noteColumns.includes("share_token")) db.exec("ALTER TABLE notes ADD COLUMN share_token TEXT");
if (!noteColumns.includes("shared_by")) db.exec("ALTER TABLE notes ADD COLUMN shared_by TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_share_token ON notes (share_token)");

// Deling inde i Flexio. target er "skole:HE<hold-id>" for et helt hold og "skole:<elev-id>" (samme som owner) for en elev.
db.exec(`
    CREATE TABLE IF NOT EXISTS note_recipients (
        note_id   TEXT NOT NULL,
        kind      TEXT NOT NULL,
        target    TEXT NOT NULL,
        name      TEXT NOT NULL,
        team_id   TEXT,
        shared_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (note_id, target)
    );
    CREATE INDEX IF NOT EXISTS note_recipients_target ON note_recipients (target);
`);

// Alle der har logget ind i Flexio - så andre kan finde dem og dele noter med dem. owner er "skole:<elev-id>".
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        owner      TEXT PRIMARY KEY,
        school     TEXT NOT NULL,
        name       TEXT NOT NULL,
        class_name TEXT NOT NULL DEFAULT '',
        last_seen  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_school ON users (school);
`);

const sql = {
    notes: db.prepare("SELECT * FROM notes WHERE owner = ? ORDER BY updated_at DESC"),
    note: db.prepare("SELECT * FROM notes WHERE id = ? AND owner = ?"),
    noteOwner: db.prepare("SELECT owner FROM notes WHERE id = ?"),
    insertNote: db.prepare(`INSERT INTO notes (id, owner, title, subject, date, lesson_date, lesson_start, tags, content, created_at, updated_at)
                            VALUES (:id, :owner, :title, :subject, :date, :lesson_date, :lesson_start, :tags, :content, :created_at, :updated_at)`),
    updateNote: db.prepare(`UPDATE notes SET title = :title, subject = :subject, date = :date, lesson_date = :lesson_date,
                            lesson_start = :lesson_start, tags = :tags, content = :content, updated_at = :updated_at
                            WHERE id = :id AND owner = :owner`),
    deleteNote: db.prepare("DELETE FROM notes WHERE id = ? AND owner = ?"),
    countNotes: db.prepare("SELECT COUNT(*) AS count FROM notes WHERE owner = ?"),

    recipients: db.prepare("SELECT * FROM note_recipients WHERE note_id = ? ORDER BY kind DESC, name"),
    insertRecipient: db.prepare(`INSERT INTO note_recipients (note_id, kind, target, name, team_id, shared_by)
                                 VALUES (:note_id, :kind, :target, :name, :team_id, :shared_by)`),
    deleteRecipients: db.prepare("DELETE FROM note_recipients WHERE note_id = ?"),
    saveUser: db.prepare(`INSERT INTO users (owner, school, name, class_name, last_seen) VALUES (?, ?, ?, ?, ?)
                          ON CONFLICT (owner) DO UPDATE SET name = excluded.name, class_name = excluded.class_name, last_seen = excluded.last_seen`),
    user: db.prepare("SELECT * FROM users WHERE owner = ?"),
    // Navnet eller klassen indeholder søgningen (LIKE er ligeglad med store/små bogstaver for a-z)
    searchUsers: db.prepare(`SELECT * FROM users WHERE school = ? AND owner != ? AND (name LIKE ? ESCAPE '\\' OR class_name LIKE ? ESCAPE '\\')
                             ORDER BY name LIMIT 20`),
    // Targets sendes som en JSON-liste. Ens egne noter tæller ikke (fx hvis man deler med sit eget hold).
    sharedWithMe: db.prepare(`SELECT notes.*, note_recipients.kind, note_recipients.name AS via, note_recipients.shared_by AS recipient_shared_by
                              FROM note_recipients JOIN notes ON notes.id = note_recipients.note_id
                              WHERE note_recipients.target IN (SELECT value FROM json_each(?)) AND notes.owner != ?
                              ORDER BY notes.updated_at DESC`),

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

    // Eleven kan findes af andre fra første login (én gang pr. session)
    if (studentId && !user.registered) {
        sql.saveUser.run(owner, user.schoolCode, name ?? "", user.student.className ?? "", now());
        user.registered = true;
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

function isUuid(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
        recipients: sql.recipients.all(row.id).map(toRecipient),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// Delt note -> det andre må se (ikke ejer, tags eller id)
function toSharedNote(row) {
    return {
        title: row.title,
        subject: row.subject,
        date: row.date,
        content: row.content,
        sharedBy: row.shared_by ?? "",
        updatedAt: row.updated_at
    };
}

// Modtager fra databasen -> til browseren (id er hold-id'et eller elev-id'et i Lectio)
function toRecipient(row) {
    const id = row.target.slice(row.target.indexOf(":") + 1).replace(/^HE/, "");
    return row.kind === "team"
        ? { type: "team", id, name: row.name }
        : { type: "student", id, name: row.name };
}

// Bruger fra databasen -> søgeresultat (id er elev-id'et i Lectio)
function toUser(row) {
    return { id: row.owner.slice(row.owner.indexOf(":") + 1), name: row.name, className: row.class_name };
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

const HOUR = 60 * 60 * 1000;

// Holdene fra elevens skema i denne og de 3 forrige uger: [{ id, name }] (gemmes på sessionen i en time).
// id er Lectios hold-id - det kan mangle, hvis skemaet ikke viser det.
async function lectioTeams(user) {
    if (user.demo) {
        const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "skema", "skema.json"), "utf8"));
        const names = [...new Set(demo.lessons.map(lesson => lesson.subject))];
        return names.map((name, index) => ({ id: `demo${index + 1}`, name }));
    }

    if (user.teams && Date.now() - user.teams.time < HOUR) return user.teams.list;

    const teams = new Map();
    for (let weeksBack = 0; weeksBack < 4; weeksBack++) {
        const { week, year } = weekOf(new Date(Date.now() - weeksBack * 7 * 86400000));
        const { lessons } = await lectio.getSchedule(user, week, year);
        lessons.forEach(lesson => {
            if (!lesson.team || lesson.team.startsWith("Alle ")) return;
            if (!teams.get(lesson.team)?.id) teams.set(lesson.team, { id: lesson.teamId ?? null, name: lesson.team });
        });
    }

    user.teams = { time: Date.now(), list: [...teams.values()] };
    return user.teams.list;
}

// Demo-holdenes elever er opdigtede - delinger med dem når ikke frem til nogen
const DEMO_STUDENTS = ["Anna Jensen", "Freja Larsen", "Mikkel Hansen", "Oliver Pedersen", "Sara Nielsen"]
    .map((name, index) => ({ id: `demo-elev${index + 1}`, name }));

// Eleverne på et af elevens hold, uden eleven selv (gemmes på sessionen i en time)
async function teamStudents(user, teamId) {
    if (user.demo) return DEMO_STUDENTS;

    user.teamStudents ??= new Map();
    const cached = user.teamStudents.get(teamId);
    if (cached && Date.now() - cached.time < HOUR) return cached.list;

    const list = (await lectio.getTeamMembers(user, teamId)).filter(student => student.id !== user.student?.studentId);
    user.teamStudents.set(teamId, { time: Date.now(), list });
    return list;
}

// Skolen i targets - demo-delinger holdes for sig
function schoolOf(user) {
    return user.demo ? "demo" : user.schoolCode;
}

function teamTarget(user, teamId) {
    return `${schoolOf(user)}:HE${teamId}`;
}

// Alt det eleven kan modtage noter som: sig selv og sine hold
async function myTargets(user) {
    const teams = await lectioTeams(user);
    return [ownerOf(user), ...teams.filter(team => team.id).map(team => teamTarget(user, team.id))];
}

// Delt note til modtageren - med id, så den kan åbnes, og hvordan den er delt
function toReceivedNote(row) {
    return {
        id: row.id,
        ...toSharedNote(row),
        sharedBy: row.recipient_shared_by,
        via: row.kind === "team" ? row.via : "dig"
    };
}

// Lectio-fejl -> svar (bruges af ruter der henter fra Lectio)
function lectioError(res, error) {
    if (error instanceof lectio.NotLoggedInError) {
        return res.status(401).json({ error: "Din Lectio-session er udløbet. Log ind igen.", code: "not_authenticated" });
    }
    console.error(error);
    res.status(502).json({ error: "Kunne ikke hente data fra Lectio" });
}

/* ---------- Ruter ---------- */

module.exports = function noterRouter(requireLogin) {
    const router = express.Router();
    router.use(["/noter", "/tags", "/fag", "/hold", "/brugere", "/delt-med-mig"], requireLogin);

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
        const body = req.body ?? {};
        const time = now();
        const id = isUuid(body.id) ? body.id.toLowerCase() : newId();

        // Findes noten allerede (samme gem sendt igen), opdateres den i stedet
        const existing = sql.noteOwner.get(id);
        if (existing && existing.owner !== owner) return res.status(409).json({ error: "Id'et er allerede brugt" });
        if (existing) {
            sql.updateNote.run({ id, owner, ...noteFields(body, owner), updated_at: time });
            return res.json(toNote(sql.note.get(id, owner)));
        }

        sql.insertNote.run({ id, owner, ...noteFields(body, owner), created_at: time, updated_at: time });
        res.status(201).json(toNote(sql.note.get(id, owner)));
    });

    router.put("/noter/:id", (req, res) => {
        const owner = ownerOf(req.user);
        if (!sql.note.get(req.params.id, owner)) return res.status(404).json({ error: "Noten findes ikke" });

        sql.updateNote.run({ id: req.params.id, owner, ...noteFields(req.body ?? {}, owner), updated_at: now() });
        res.json(toNote(sql.note.get(req.params.id, owner)));
    });

    router.delete("/noter/:id", (req, res) => {
        const { changes } = sql.deleteNote.run(req.params.id, ownerOf(req.user));
        if (changes > 0) sql.deleteRecipients.run(req.params.id);
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

    // Kopien får ingen tags - de hører til den der delte noten
    function copyNote(req, res, row) {
        const owner = ownerOf(req.user);
        const time = now();
        const id = newId();
        const fields = noteFields({ title: row.title, subject: row.subject, date: row.date, content: row.content }, owner);

        sql.insertNote.run({ id, owner, ...fields, created_at: time, updated_at: time });
        res.status(201).json(toNote(sql.note.get(id, owner)));
    }

    /* Deling inde i Flexio */

    router.get("/hold", async (req, res) => {
        try {
            const teams = (await lectioTeams(req.user)).filter(team => team.id);
            res.json({ teams: teams.sort((a, b) => a.name.localeCompare(b.name, "da")) });
        } catch (error) {
            lectioError(res, error);
        }
    });

    router.get("/hold/:id/elever", async (req, res) => {
        try {
            const team = (await lectioTeams(req.user)).find(item => item.id && item.id === req.params.id);
            if (!team) return res.status(404).json({ error: "Du går ikke på det hold" });

            res.json({ students: await teamStudents(req.user, team.id) });
        } catch (error) {
            lectioError(res, error);
        }
    });

    // Andre Flexio-brugere på samme skole, som man kan dele med. Demo-brugeren søger i de opdigtede elever.
    router.get("/brugere", (req, res) => {
        const search = text(req.query.q, 60).trim();
        if (search.length < 2) return res.json({ users: [] });

        if (req.user.demo) {
            const users = DEMO_STUDENTS.filter(student => student.name.toLowerCase().includes(search.toLowerCase()));
            return res.json({ users: users.map(student => ({ ...student, className: "Demo" })) });
        }

        const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
        const rows = sql.searchUsers.all(req.user.schoolCode, ownerOf(req.user), pattern, pattern);
        res.json({ users: rows.map(toUser) });
    });

    // Hele listen af modtagere sendes hver gang: [{ type: "student", id }, ...].
    // Man kan dele med andre Flexio-brugere på sin skole - navnene kommer fra databasen, ikke fra browseren.
    // Hold som noten allerede var delt med (fra før søgningen), kan kun beholdes eller fjernes.
    router.put("/noter/:id/modtagere", (req, res) => {
        const owner = ownerOf(req.user);
        const row = sql.note.get(req.params.id, owner);
        if (!row) return res.status(404).json({ error: "Noten findes ikke" });

        const wanted = Array.isArray(req.body?.recipients) ? req.body.recipients.slice(0, 500) : [];
        const existing = sql.recipients.all(row.id);
        const recipients = new Map();

        for (const item of wanted) {
            if (item?.type === "team") {
                const team = existing.find(entry => entry.kind === "team" && entry.target === teamTarget(req.user, String(item.id)));
                if (team) recipients.set(team.target, { kind: "team", target: team.target, name: team.name, team_id: team.team_id });
            } else if (item?.type === "student") {
                const target = `${schoolOf(req.user)}:${String(item.id)}`;
                const student = req.user.demo
                    ? DEMO_STUDENTS.find(entry => entry.id === String(item.id))
                    : sql.user.get(target);
                if (student && target !== owner) recipients.set(target, { kind: "student", target, name: student.name, team_id: null });
            }
        }

        const sharedBy = req.user.student?.name ?? "";
        db.exec("BEGIN");
        try {
            sql.deleteRecipients.run(row.id);
            recipients.forEach(recipient => sql.insertRecipient.run({ note_id: row.id, ...recipient, shared_by: sharedBy }));
            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

        res.json(toNote(sql.note.get(row.id, owner)));
    });

    // Samme note kan være delt med både eleven og elevens hold - den vises kun én gang
    async function receivedNotes(user) {
        const rows = sql.sharedWithMe.all(JSON.stringify(await myTargets(user)), ownerOf(user));
        const byId = new Map();
        rows.forEach(row => {
            if (!byId.has(row.id) || row.kind === "student") byId.set(row.id, row);
        });
        return [...byId.values()];
    }

    router.get("/delt-med-mig", async (req, res) => {
        try {
            res.json({ notes: (await receivedNotes(req.user)).map(toReceivedNote) });
        } catch (error) {
            lectioError(res, error);
        }
    });

    router.get("/delt-med-mig/:id", async (req, res) => {
        try {
            const row = (await receivedNotes(req.user)).find(item => item.id === req.params.id);
            if (!row) return res.status(404).json({ error: "Noten findes ikke, eller den er ikke delt med dig længere" });

            res.json(toReceivedNote(row));
        } catch (error) {
            lectioError(res, error);
        }
    });

    router.post("/delt-med-mig/:id/kopi", async (req, res) => {
        try {
            const row = (await receivedNotes(req.user)).find(item => item.id === req.params.id);
            if (!row) return res.status(404).json({ error: "Noten findes ikke, eller den er ikke delt med dig længere" });

            copyNote(req, res, row);
        } catch (error) {
            lectioError(res, error);
        }
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
            fromLectio = (await lectioTeams(req.user)).map(team => team.name);
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
