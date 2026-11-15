// Henter og læser sider fra lectio.dk (web-scraping, da Lectio ikke har et officielt API).
// Idéen kommer fra https://github.com/TobiasViskum/lectio-api

const cheerio = require("cheerio");

const LECTIO = "https://www.lectio.dk/lectio";

class NotLoggedInError extends Error {}

/* ---------- Hent sider ---------- */

// Henter en side som den loggede ind elev. Sender Lectio os videre til login, er cookien ikke gyldig.
async function getPage(user, page, { partial = false } = {}) {
    const response = await fetch(`${LECTIO}/${user.schoolCode}/${page}`, {
        headers: { Cookie: user.cookie },
        redirect: "manual"
    });

    const html = response.status === 200 ? await response.text() : "";

    // Sider for en logget ind bruger har altid et "Log ud"-link. Små sider (partial) har det ikke - dem kender vi på, at der kom noget
    if (partial ? !html : !html.includes("logout.aspx")) throw new NotLoggedInError();

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

// Hvilken side hører til hvilket id (bogstavet foran id'et, som i Lectios "Find skema")
const SCHEDULE_OWNERS = [
    [/^S(\d+)$/, id => `type=elev&elevid=${id}`],
    [/^T(\d+)$/, id => `type=laerer&laererid=${id}`],
    [/^C(\d+)$/, id => `type=stamklasse&klasseid=${id}`],
    [/^RE(\d+)$/, id => `type=lokale&nosubnav=1&id=${id}`],
    [/^R(\d+)$/, id => `type=lokale&nosubnav=1&id=${id}`],
    [/^(?:HE|G)(\d+)$/, id => `type=holdelement&holdelementid=${id}`]
];

// Skemaet for eleven selv, eller for en anden (who = fx "S12345", "T678", "HE9")
async function getSchedule(user, week, year, who) {
    const owner = who && SCHEDULE_OWNERS.map(([pattern, build]) => who.match(pattern) && build(who.match(pattern)[1])).find(Boolean);
    if (who && !owner) throw new Error("Ugyldigt skema");

    const html = await getPage(user, `SkemaNy.aspx?${owner ? `${owner}&` : ""}week=${String(week).padStart(2, "0")}${year}`);
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

        // Holdnavnene i brikken har et Lectio-id: <span data-lectiocontextcard="HE12345">2y Fy</span>
        const teamCards = [];
        $(brick).find("[data-lectiocontextcard]").each((_, element) => {
            const id = ($(element).attr("data-lectiocontextcard") ?? "").match(/^HE(\d+)$/)?.[1];
            if (id && !teamCards.some(team => team.id === id)) teamCards.push({ id, name: clean($(element).text()) });
        });

        lessons.push({
            date: lesson.date,
            start: lesson.start,
            end: lesson.end,
            subject: oneTeam ? lesson.teams[0] : (lesson.title || lesson.teams.join(", ")),
            team: oneTeam ? lesson.teams[0] : "",
            teamId: oneTeam ? (teamCards.find(team => team.name === lesson.teams[0]) ?? teamCards[0])?.id ?? null : null,
            topic: oneTeam ? lesson.title : "",
            teacher: lesson.teachers.join(" "),
            room: lesson.rooms.join(" "),
            note: lesson.note.join("\n"),
            homework: lesson.homework.length > 0,
            homeworkItems: lesson.homework,
            status: $(brick).hasClass("s2cancelled") ? "cancelled" : $(brick).hasClass("s2changed") ? "changed" : "normal"
        });
    });

    return { title: clean($("#s_m_HeaderContent_MainTitle").text()), modules, lessons };
}

/* ---------- Elever på et hold ---------- */

// Holdets deltagerliste. Hver elev står i en række med links/kort som data-lectiocontextcard="S12345"
// (fornavn og efternavn kan stå i hver sin celle, så teksten samles pr. række).
async function getTeamMembers(user, teamId) {
    const $ = cheerio.load(await getPage(user, `subnav/members.aspx?holdelementid=${teamId}&showstudents=1&showteachers=0`));
    const students = new Map();

    $("tr").each((_, row) => {
        const parts = [];
        let id = null;

        $(row).find("[data-lectiocontextcard], a[href*='elevid=']").each((_, element) => {
            const studentId = ($(element).attr("data-lectiocontextcard") ?? "").match(/^S(\d+)$/)?.[1]
                ?? ($(element).attr("href") ?? "").match(/elevid=(\d+)/)?.[1];
            if (!studentId) return;

            id ??= studentId;
            const text = clean($(element).text());
            if (studentId === id && text && !parts.includes(text)) parts.push(text);
        });

        if (id && parts.length && !students.has(id)) students.set(id, { id, name: parts.join(" ") });
    });

    return [...students.values()].sort((a, b) => a.name.localeCompare(b.name, "da"));
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

/* ---------- Fravær ---------- */

// Fraværssiden har en tabel med én række pr. hold og kolonner som "Fravær (moduler)" og "Fravær (%)".
// Vi kender ikke kolonnerne på forhånd, så vi sender overskrifter og celler videre som tekst.
// Opbygningen af Lectios fraværssider er set i BetterLectios kode (github.com/BetterLectio/betterLectio, apps/api/lectio/_fravær.py).
//
// subnav/fravaerelev.aspx: tabellen #s_m_Content_Content_SFTabStudentAbsenceDataTable har én række pr. hold:
//   Hold | Opgjort fravær % | Opgjort fravær moduler | Hele året % | Hele året moduler   (og en række "Samlet")
//
// subnav/fravaerelev_fravaersaarsager.aspx har to tabeller med moduler med fravær:
//   #s_m_Content_Content_FatabMissingAarsagerGV   fravær hvor årsag mangler
//   #s_m_Content_Content_FatabAbsenceFravaerGV    fravær med årsag
//   Uge | Aktivitet (skemabrik) | Fravær | Type | Registreret + lærer | Bemærkning | Årsag + note
function readAbsenceModules($, selector, missing, user) {
    const modules = [];

    $(`${selector} tr`).slice(1).each((_, row) => {
        const cells = $(row).children("td").toArray();
        if (cells.length < 6) return; // fx "Der er ingen manglende fraværsårsager"

        const lesson = readTooltip($(row).find("a.s2skemabrik").attr("data-tooltip")) ?? {};
        const text = index => clean($(cells[index]).text());

        // Lectios eget skema til at angive/rette årsag: fravaer_aarsag.aspx?elevid=..&id=<absid>&atype=aa (som i BetterLectio)
        const absId = ($(row).find("a.s2skemabrik").attr("href") ?? "").match(/absid=(\d+)/i)?.[1];
        const reasonUrl = absId && user?.studentId
            ? `${LECTIO}/${user.schoolCode}/fravaer_aarsag.aspx?elevid=${user.studentId}&id=${absId}&atype=aa`
            : null;
        const [reason = "", reasonNote = ""] = (cells[6] ? $(cells[6]).text() : "").split(/\n+|\s{3,}/).map(clean).filter(Boolean);

        modules.push({
            week: text(0),
            date: lesson.date ?? null,
            start: lesson.start ?? "",
            end: lesson.end ?? "",
            subject: lesson.teams?.join(", ") || lesson.title || "",
            title: lesson.title ?? "",
            absence: text(2),
            type: text(3),
            registered: text(4),
            comment: text(5),
            reason: missing ? "" : reason ?? "",
            reasonNote: missing ? "" : reasonNote ?? "",
            missingReason: missing,
            reasonUrl
        });
    });

    return modules;
}

async function getAbsence(user) {
    const id = user.student.studentId;
    const $ = cheerio.load(await getPage(user, `subnav/fravaerelev.aspx?elevid=${id}`));

    // Lectios id for tabellen har et præfiks, fx "..._ElevUpdatePanel_FravaerOversigt_SFTabStudentAbsenceDataTable"
    const tables = $("table").toArray();
    const table = $("table[id$='SFTabStudentAbsenceDataTable']")[0]
        ?? tables.find(element => /opgjort/i.test($(element).text()) && /hele året/i.test($(element).text()));

    const rows = $(table).find("tr").toArray().map(row => ({
        id: $(row).attr("id"),
        cells: $(row).children("th, td").toArray().map(cell => clean($(cell).text()))
    }));

    // Overskrifterne står i et par rækker over holdene (Hold | Almindeligt fravær | Skriftligt fravær og under dem Opgjort/Hele året).
    // Rækkefølgen af de fire tal er som standard: opgjort %, opgjort moduler, hele året %, hele året moduler.
    // Står der noget andet i overskrifterne, følger vi dem.
    const header = rows.filter(row => row.cells.some(cell => /%|modul/i.test(cell)) && !row.cells.some(cell => /^\d/.test(cell)));
    const order = { periodPct: 1, periodModules: 2, yearPct: 3, yearModules: 4 };
    const labels = header.at(-1)?.cells.filter(Boolean).slice(0, 4) ?? [];

    if (labels.length === 4) {
        labels.forEach((label, index) => {
            const year = /år|helt/i.test(label);
            const pct = /%/.test(label);
            if (/opgjort|år|helt/i.test(label)) order[`${year ? "year" : "period"}${pct ? "Pct" : "Modules"}`] = index + 1;
        });
    }

    const teams = [];
    for (const { cells } of rows) {
        if (cells.length < 5 || !cells[0] || !/\d/.test(cells[1])) continue;

        teams.push({
            name: cells[0],
            period: { pct: cells[order.periodPct], modules: cells[order.periodModules] },
            year: { pct: cells[order.yearPct], modules: cells[order.yearModules] }
        });
    }

    if (!teams.length) {
        // Hjælp til fejlfinding: hvad så vi på siden?
        const seen = tables.slice(0, 6).map(element => `${$(element).attr("id") ?? "uden id"}: ${clean($(element).find("tr").first().text()).slice(0, 60)}`);
        console.error("Fraværstabel ikke fundet. Titel:", clean($("title").text()), "Tabeller:", seen);
        const error = new Error(`Kunne ikke læse fraværssiden fra Lectio (${clean($("title").text()) || "ingen titel"}; ${tables.length} tabeller)`);
        error.expose = true;
        throw error;
    }

    // Meddelelser/advarsler om fravær (Dato | Initialer | Type | Note)
    const warnings = [];
    $("table[id$='SFTabWarningGV'] tr").each((_, row) => {
        const cells = $(row).children("td").toArray().map(cell => clean($(cell).text()));
        if (cells.length >= 4 && cells[0]) warnings.push({ date: cells[0], initials: cells[1], type: cells[2], note: cells[3] });
    });

    // Moduler med fravær. Mislykkes denne side, vises resten alligevel
    let missing = [];
    let registered = [];

    try {
        const reasons = cheerio.load(await getPage(user, `subnav/fravaerelev_fravaersaarsager.aspx?elevid=${id}`));
        missing = readAbsenceModules(reasons, "table[id$=FatabMissingAarsagerGV]", true, { ...user, studentId: id });
        registered = readAbsenceModules(reasons, "table[id$=FatabAbsenceFravaerGV]", false, { ...user, studentId: id });
    } catch (error) {
        console.error(error);
    }

    return { teams, warnings, missing, registered };
}

module.exports = { LECTIO, getPage, clean, readTooltip, toIso, NotLoggedInError, getSchools, getStudent, getSchedule, getTeamMembers, getAssignments, getGrades, getAbsence };
