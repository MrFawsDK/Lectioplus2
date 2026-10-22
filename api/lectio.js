// Henter og læser sider fra lectio.dk (web-scraping, da Lectio ikke har et officielt API).
// Idéen kommer fra https://github.com/TobiasViskum/lectio-api

const cheerio = require("cheerio");

const LECTIO = "https://www.lectio.dk/lectio";

class NotLoggedInError extends Error {}

/* ---------- Hent sider ---------- */

// Henter en side som den loggede ind elev. Sender Lectio os videre til login, er cookien ikke gyldig.
async function getPage(user, page) {
    const response = await fetch(`${LECTIO}/${user.schoolCode}/${page}`, {
        headers: { Cookie: user.cookie },
        redirect: "manual"
    });

    const html = response.status === 200 ? await response.text() : "";

    // Sider for en logget ind bruger har altid et "Log ud"-link
    if (!html.includes("logout.aspx")) throw new NotLoggedInError();

    return html;
}

/* ---------- Hjælpere ---------- */

function clean(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
}

// "8:00" -> "08:00"
function padTime(time) {
    const [hours, minutes] = time.split(":");
    return `${hours.padStart(2, "0")}:${minutes}`;
}

// "28/8-2026 23:30" -> "2026-08-28T23:30"
function toIso(text) {
    const match = clean(text).match(/^(\d{1,2})\/(\d{1,2})-(\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
    if (!match) return null;

    const [, day, month, year, time] = match;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return time ? `${date}T${padTime(time)}` : date;
}

/* ---------- Skoler ---------- */

async function getSchools() {
    const html = await (await fetch(`${LECTIO}/login_list.aspx`)).text();
    const $ = cheerio.load(html);
    const schools = [];

    $("a[href*='/default.aspx']").each((_, link) => {
        const match = ($(link).attr("href") ?? "").match(/\/lectio\/(\d+)\/default\.aspx/);
        if (match) schools.push({ schoolCode: match[1], name: clean($(link).text()) });
    });

    return schools.sort((a, b) => a.name.localeCompare(b.name, "da"));
}

/* ---------- Eleven ---------- */

async function getStudent(user) {
    const $ = cheerio.load(await getPage(user, "forside.aspx"));

    // <title>Eleven Navn Navnesen, 2y 25htx - Forside - Lectio - Skole</title>
    const match = clean($("title").text()).match(/^(?:Eleven|Læreren)\s+(.+?),\s*(.+?)\s+-\s+/);

    // Elevens id i Lectio, fx forside.aspx?elevid=12345 - bruges til at finde elevens noter i databasen
    const startUrl = $('meta[name="msapplication-starturl"]').attr("content") ?? "";
    const id = startUrl.match(/elevid=(\d+)/)?.[1] ?? null;

    return {
        name: match ? match[1] : "Elev",
        className: match ? match[2] : "",
        schoolName: clean($(".ls-master-header-institution-name").first().text()),
        studentId: id
    };
}

/* ---------- Skema ---------- */

// Hver brik i skemaet har en "data-tooltip" med alle oplysninger, fx:
//   Ændret!
//   Film
//   28/9-2026 09:50 til 11:20
//   Hold: 2y 25htx InfB
//   Lærere: ABD, AHSO
//   Lokale: h202
//
//   Lektier:
//   - læs side 22-26
//
//   Note:
//   ...
function readTooltip(tooltip) {
    const lines = String(tooltip ?? "").replace(/\r/g, "").split("\n").map(line => line.trim());
    const lesson = { title: "", teams: [], teachers: [], rooms: [], homework: [], note: [] };

    let section = "top";

    for (const line of lines) {
        const time = line.match(/^(\d{1,2}\/\d{1,2}-\d{4})\s+(\d{1,2}:\d{2})\s+til\s+(\d{1,2}:\d{2})/);

        if (line === "Ændret!" || line === "Aflyst!") continue;
        if (line === "Lektier:" || line === "Note:" || line === "Øvrigt indhold:") {
            section = line;
            continue;
        }

        if (time) {
            lesson.date = toIso(time[1]);
            lesson.start = padTime(time[2]);
            lesson.end = padTime(time[3]);
            section = "info";
        } else if (section === "top" && line) {
            lesson.title = lesson.title ? `${lesson.title} ${line}` : line;
        } else if (section === "info") {
            const [key, ...rest] = line.split(":");
            const values = rest.join(":").split(",").map(clean).filter(Boolean);

            if (key === "Hold") lesson.teams = values;
            if (key === "Lærer" || key === "Lærere") lesson.teachers = values.map(value => value.match(/\(([^)]+)\)$/)?.[1] ?? value);
            if (key === "Lokale" || key === "Lokaler") lesson.rooms = values;
        } else if (section === "Lektier:" && line) {
            lesson.homework.push(line.replace(/^-\s*/, "").replace(/\s*\[\.\.\.\]$/, ""));
        } else if (section === "Note:" && line) {
            lesson.note.push(line);
        }
    }

    return lesson.start ? lesson : null;
}

async function getSchedule(user, week, year) {
    const html = await getPage(user, `SkemaNy.aspx?week=${String(week).padStart(2, "0")}${year}`);
    const $ = cheerio.load(html);

    // Moduler fra venstre kolonne: "1. modul<br>8:00 - 9:30"
    const modules = [];
    $(".s2module-info").each((_, element) => {
        const [name, times] = ($(element).html() ?? "").split(/<br\s*\/?>/i).map(part => clean(cheerio.load(part).text()));
        const match = times?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (match && !modules.some(module => module.name === name)) {
            modules.push({ name, start: padTime(match[1]), end: padTime(match[2]) });
        }
    });

    const lessons = [];
    $("td[data-date] a.s2skemabrik").each((_, brick) => {
        const lesson = readTooltip($(brick).attr("data-tooltip"));
        if (!lesson) return;

        const oneTeam = lesson.teams.length === 1;

        lessons.push({
            date: lesson.date,
            start: lesson.start,
            end: lesson.end,
            subject: oneTeam ? lesson.teams[0] : (lesson.title || lesson.teams.join(", ")),
            team: oneTeam ? lesson.teams[0] : "",
            topic: oneTeam ? lesson.title : "",
            teacher: lesson.teachers.join(" "),
            room: lesson.rooms.join(" "),
            note: lesson.note.join("\n"),
            homework: lesson.homework.length > 0,
            homeworkItems: lesson.homework,
            status: $(brick).hasClass("s2cancelled") ? "cancelled" : $(brick).hasClass("s2changed") ? "changed" : "normal"
        });
    });

    return { modules, lessons };
}

/* ---------- Opgaver ---------- */

// Kolonnerne i Lectios opgavetabel (findes ud fra overskrifterne, kun bogstaver, fx "Elev-tid" -> "elevtid")
const COLUMNS = {
    "hold": "subject",
    "opgavetitel": "title",
    "frist": "deadline",
    "elevtid": "hours",
    "status": "status",
    "fravær": "absence",
    "afventer": "waitingFor",
    "opgavenote": "note",
    "karakter": "grade",
    "elevnote": "studentNote"
};

function columnKey(text) {
    return COLUMNS[clean(text).toLowerCase().replace(/[^a-zæøå]/g, "")] ?? null;
}

// Lectios status som tekst -> vores status. Fx "Afleveret", "Afleveret for sent", "Venter", "Mangler"
function readStatus(text) {
    const value = clean(text).toLowerCase();
    if (value.startsWith("aflever")) return "submitted";
    if (value.startsWith("mangler")) return "missing";
    if (value.startsWith("venter")) return "pending";
    return null;
}

async function getAssignments(user) {
    const $ = cheerio.load(await getPage(user, "OpgaverElev.aspx"));

    const table = $("table").filter((_, element) => $(element).find("tr").first().text().includes("Opgavetitel")).first();

    // Én plads pr. kolonne - en overskrift med colspan="2" fylder to pladser, ellers rykker cellerne
    const columns = [];
    table.find("tr").first().children("th, td").each((_, cell) => {
        const span = Number($(cell).attr("colspan")) || 1;
        for (let i = 0; i < span; i++) columns.push(columnKey($(cell).text()));
    });

    const assignments = [];

    table.find("tr").slice(1).each((_, row) => {
        const cells = $(row).children("td").toArray();
        const raw = {};

        // Har rækken flere celler end overskriften (fx et ikon forrest), springes de første over
        const offset = Math.max(0, cells.length - columns.length);

        columns.forEach((key, index) => {
            const cell = cells[index + offset];
            if (key && cell) raw[key] = clean($(cell).text());
        });

        // Passer kolonnerne ikke helt, findes status ud fra cellernes tekst
        const status = readStatus(raw.status)
            ?? cells.map(cell => readStatus($(cell).text())).find(Boolean)
            ?? "pending";

        const deadline = toIso(raw.deadline);
        if (!raw.title || !deadline) return;

        assignments.push({
            title: raw.title,
            subject: raw.subject ?? "",
            deadline,
            hours: Number((raw.hours ?? "0").replace(",", ".")) || 0,
            status,
            absence: raw.absence ? parseFloat(raw.absence.replace(",", ".")) : undefined,
            waitingFor: raw.waitingFor || undefined,
            note: raw.note || undefined,
            grade: raw.grade || undefined,
            studentNote: raw.studentNote || undefined
        });
    });

    const subjects = [...new Set(assignments.map(item => item.subject))].sort((a, b) => a.localeCompare(b, "da"));
    return { subjects, assignments };
}

/* ---------- Karakterer ---------- */

// Karakterbladet er en tabel med én række pr. hold og én kolonne pr. karaktertype:
//   Hold | Fag | 1. standpunkt | 2. standpunkt | Årskarakter | Eksamen ...
// En celle kan indeholde mere end selve karakteren (fx vægt), så karakteren findes i starten af teksten.
const GRADE = /^(-3|00|02|4|7|10|12|ikke bestået|bestået|ikke godkendt|godkendt)(?![\dæøåa-z])/i;

async function getGrades(user) {
    const $ = cheerio.load(await getPage(user, `grades/grade_report.aspx?elevid=${user.student.studentId}`));

    const table = $("table").filter((_, element) => /standpunkt|årskarakter|eksamen/i.test($(element).find("tr").first().text())).first();

    const columns = [];
    table.find("tr").first().children("th, td").each((_, cell) => {
        const span = Number($(cell).attr("colspan")) || 1;
        for (let i = 0; i < span; i++) columns.push(clean($(cell).text()));
    });

    const types = columns.filter(name => name && !/^(hold|fag)$/i.test(name));
    const subjects = [];

    table.find("tr").slice(1).each((_, row) => {
        const cells = $(row).children("td").toArray().map(cell => clean($(cell).text()));
        const offset = Math.max(0, cells.length - columns.length);
        const value = name => cells[columns.indexOf(name) + offset] ?? "";

        const team = value(columns.find(name => /^hold$/i.test(name)));
        const subject = value(columns.find(name => /^fag$/i.test(name))) || team;
        if (!subject) return;

        const grades = types
            .map(type => ({ type, grade: value(type).match(GRADE)?.[1] }))
            .filter(item => item.grade);

        subjects.push({ subject, team, grades });
    });

    return { types, subjects };
}

module.exports = { NotLoggedInError, getSchools, getStudent, getSchedule, getAssignments, getGrades };
