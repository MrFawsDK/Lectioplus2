// Forsiden samler det vigtigste fra skema, opgaver og fravær

const DAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ISO-ugenummer, som Lectio bruger i skema-adressen
function isoWeek(date) {
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
    const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    return { week: Math.ceil(((day - start) / 86400000 + 1) / 7), year: day.getUTCFullYear() };
}

function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function list(element, items, emptyText) {
    element.innerHTML = items.length ? items.join("") : `<li class="empty-line">${emptyText}</li>`;
}

async function loadLessons() {
    const now = new Date();
    const { week, year } = isoWeek(now);
    const { lessons } = await apiGet(`/api/skema?week=${week}&year=${year}`);
    const today = isoDate(now);

    // Dagens moduler - er der ingen i dag (weekend, ferie), vises den næste dag med moduler i ugen
    const days = [...new Set(lessons.map(lesson => lesson.date))].sort();
    const day = days.includes(today) ? today : days.find(date => date > today);
    const title = document.querySelector("#lessonsTitle");

    if (!day) {
        title.textContent = "Skema";
        return list(document.querySelector("#lessons"), [], "Ingen moduler resten af ugen.");
    }

    const date = new Date(`${day}T12:00`);
    title.textContent = day === today ? "Skema i dag" : `Skema ${DAYS[date.getDay()]}`;

    list(document.querySelector("#lessons"), lessons
        .filter(lesson => lesson.date === day)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map(lesson => `
            <li style="${subjectStyle(lesson.subject)}">
                <span class="${lesson.status === "cancelled" ? "cancelled" : ""}">${escapeHtml(lesson.subject)}</span>
                <span class="meta">${escapeHtml(lesson.start)}–${escapeHtml(lesson.end)}${lesson.room ? ` · ${escapeHtml(lesson.room)}` : ""}</span>
            </li>`), "");
}

async function loadAssignments() {
    const { assignments } = await apiGet("/api/opgaver");

    const missing = assignments
        .filter(item => item.status !== "submitted")
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .slice(0, 5);

    list(document.querySelector("#assignments"), missing.map(item => `
        <li style="${subjectStyle(item.subject)}">
            <span>${escapeHtml(item.title)}<br><small class="meta">${escapeHtml(item.subject)}</small></span>
            <span class="meta">${escapeHtml(item.deadline.slice(0, 10).split("-").reverse().join("/"))}</span>
        </li>`), "Ingen opgaver mangler.");
}

async function loadAbsence() {
    const { rows } = await apiGet("/api/fravaer");
    const total = rows.find(row => /^(i alt|samlet)/i.test(row.name));
    const value = total?.cells.find(cell => /%/.test(cell));
    document.querySelector("#absence").textContent = value ?? "-";
}

async function loadHome() {
    const me = await getMe();
    document.querySelector("#hello").textContent = `Hej ${me.student?.name?.split(" ")[0] ?? ""}`.trim();
    document.querySelector("#subtitle").textContent = [me.student?.className, me.student?.schoolName].filter(Boolean).join(" · ");

    // Hver boks hentes for sig, så en fejl ét sted ikke tager resten af forsiden med
    for (const [load, id] of [[loadLessons, "lessons"], [loadAssignments, "assignments"], [loadAbsence, "absence"]]) {
        load().catch(() => {
            const element = document.querySelector(`#${id}`);
            id === "absence" ? (element.textContent = "-") : list(element, [], "Kunne ikke hentes.");
        });
    }
}

loadHome();
