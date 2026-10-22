// Opgaverne hentes fra vores server, som henter dem fra Lectio
const DATA_URL = "/api/opgaver";

// Afleverede opgaver med frist længere tilbage end dette, er ikke "aktuelle"
const CURRENT_DAYS = 90;

const STATUS = {
    pending: { label: "Venter", icon: "schedule" },
    missing: { label: "Mangler", icon: "assignment_late" },
    submitted: { label: "Afleveret", icon: "task_alt" }
};

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

let subjects = [];
let assignments = [];
let selectedTeam = "Alle";

const currentOnly = document.querySelector("#currentOnly");
const schoolYearOnly = document.querySelector("#schoolYearOnly");

// Filtrenes starttilstand fra HTML'en læses før M3-komponenterne er indlæst
const initialFilters = [currentOnly, schoolYearOnly].map(chip => chip.hasAttribute("selected"));


/* ---------- Hjælpere ---------- */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

function getMonday(date) {
    const result = startOfDay(date);
    result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
    return result;
}

function getWeekNumber(date) {
    const target = startOfDay(date);
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    return 1 + Math.round(
        ((target - firstThursday) / 86400000
            - 3 + ((firstThursday.getDay() + 6) % 7)) / 7
    );
}

function formatTime(date) {
    return date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
}

function formatDeadline(date) {
    const day = date.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });
    return `${day} kl. ${formatTime(date)}`;
}

function formatNumber(value) {
    return String(value).replace(".", ",");
}

function daysUntil(date) {
    return Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
}

function relativeText(date) {
    const days = daysUntil(date);

    if (days === 0) return "I dag";
    if (days === 1) return "I morgen";
    if (days > 1) return `Om ${days} dage`;
    if (days === -1) return "I går";
    return `${-days} dage siden`;
}

function statusOf(assignment) {
    // Lectios egen status bruges direkte - Lectio skriver selv "Mangler", når en opgave mangler
    return STATUS[assignment.status] ? assignment.status : "pending";
}

// Skoleåret går fra 1. august til 31. juli
function inCurrentSchoolYear(date) {
    const now = new Date();
    const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return date >= new Date(startYear, 7, 1) && date < new Date(startYear + 1, 7, 1);
}

function isCurrent(assignment) {
    if (statusOf(assignment) !== "submitted") return true;

    const limit = new Date();
    limit.setDate(limit.getDate() - CURRENT_DAYS);
    return new Date(assignment.deadline) >= limit;
}


/* ---------- Filtre ---------- */

function renderTeamChips() {
    const chipSet = document.querySelector("#teamChips");

    // M3: Chips - Filter chip
    // Guide: https://m3.material.io/components/chips/overview
    // Element: <md-filter-chip> fra @material/web/chips/filter-chip.js
    chipSet.innerHTML = ["Alle", ...subjects]
        .map(team => {
            const selected = team === selectedTeam ? " selected" : "";
            const label = team === "Alle" ? "Alle hold" : team;
            return `<md-filter-chip label="${escapeHtml(label)}" data-team="${escapeHtml(team)}"${selected}></md-filter-chip>`;
        })
        .join("");

    chipSet.querySelectorAll("[data-team]").forEach(chip => {
        chip.addEventListener("click", () => {
            selectedTeam = chip.dataset.team;
            renderTeamChips();
            render();
        });
    });
}

// Filter chips skifter selv "selected" ved klik
currentOnly.addEventListener("click", render);
schoolYearOnly.addEventListener("click", render);

function filteredAssignments() {
    return assignments.filter(assignment => {
        const deadline = new Date(assignment.deadline);

        if (selectedTeam !== "Alle" && assignment.subject !== selectedTeam) return false;
        if (currentOnly.selected && !isCurrent(assignment)) return false;
        if (schoolYearOnly.selected && !inCurrentSchoolYear(deadline)) return false;

        return true;
    });
}


/* ---------- Overblik ---------- */

function renderStats(list) {
    const missing = list.filter(item => statusOf(item) === "missing").length;
    const submitted = list.filter(item => statusOf(item) === "submitted").length;
    const upcoming = list.filter(item => statusOf(item) === "pending");
    const hoursLeft = upcoming.reduce((sum, item) => sum + (item.hours ?? 0), 0);

    document.querySelector("#statUpcoming").textContent = String(upcoming.length);
    document.querySelector("#statMissing").textContent = String(missing);
    document.querySelector("#statSubmitted").textContent = String(submitted);
    document.querySelector("#statHours").textContent = `${formatNumber(hoursLeft)} t`;

    document.querySelector(".stat.missing").classList.toggle("active", missing > 0);

    // Kort tekst om ugen
    const thisMonday = getMonday(new Date()).getTime();
    const thisWeek = upcoming.filter(item => getMonday(new Date(item.deadline)).getTime() === thisMonday);
    const next = [...upcoming].sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];

    const parts = [thisWeek.length === 1 ? "1 aflevering denne uge" : `${thisWeek.length} afleveringer denne uge`];
    if (next) parts.push(`næste er ${next.title} ${relativeText(new Date(next.deadline)).toLowerCase()}`);

    document.querySelector("#lead").textContent = parts.join(" · ");
}


/* ---------- Sektioner ---------- */

function weekHeading(monday) {
    const thisMonday = getMonday(new Date());
    const diffWeeks = Math.round((monday - thisMonday) / (7 * 86400000));
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    const range = `${monday.getDate()}/${monday.getMonth() + 1} - ${sunday.getDate()}/${sunday.getMonth() + 1}`;
    const week = getWeekNumber(monday);

    if (diffWeeks === 0) return { title: "Denne uge", meta: `Uge ${week} · ${range}` };
    if (diffWeeks === 1) return { title: "Næste uge", meta: `Uge ${week} · ${range}` };
    return { title: `Uge ${week}`, meta: range };
}

// M3: Lists - List item (type="button" gør den klikbar med ripple)
// Guide: https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
// Ikoner: <md-icon> (Material Symbols) - https://m3.material.io/styles/icons/overview
function assignmentItem(assignment) {
    const index = assignments.indexOf(assignment);
    const status = statusOf(assignment);
    const deadline = new Date(assignment.deadline);
    const soon = status === "pending" && daysUntil(deadline) <= 1;

    const meta = [
        assignment.subject,
        assignment.teacher,
        assignment.hours ? `${formatNumber(assignment.hours)} t elevtid` : "",
        assignment.waitingFor ? `afventer ${assignment.waitingFor.toLowerCase()}` : "",
        assignment.absence ? `${assignment.absence} % fravær` : ""
    ].filter(Boolean).map(escapeHtml).join(" · ");

    const note = assignment.note ?? assignment.studentNote;

    let trailing;
    if (status === "submitted") {
        trailing = assignment.grade
            ? `<span class="grade">${escapeHtml(assignment.grade)}</span>`
            : `<span class="when">Afleveret</span>`;
    } else {
        trailing = `<span class="when${soon ? " soon" : ""}">${relativeText(deadline)}</span>`;
    }

    return `
        <md-list-item type="button" data-index="${index}" class="assignment ${status}">
            <div slot="start" class="date-badge ${status}">
                <span class="date-day">${deadline.getDate()}</span>
                <span class="date-month">${MONTHS[deadline.getMonth()]}</span>
            </div>
            <div slot="headline" class="assignment-title">${escapeHtml(assignment.title)}</div>
            <div slot="supporting-text" class="assignment-meta">
                <span>${meta}</span>
                ${note ? `<span class="assignment-note">${escapeHtml(note)}</span>` : ""}
            </div>
            <div slot="end" class="assignment-end">
                ${trailing}
                <span class="time">kl. ${formatTime(deadline)}</span>
            </div>
        </md-list-item>
    `;
}

function sectionHtml({ title, meta, icon, className = "" }, items) {
    return `
        <section class="section ${className}">
            <div class="section-head">
                ${icon ? `<md-icon>${icon}</md-icon>` : ""}
                <h2>${title}</h2>
                <span class="section-meta">${meta ?? ""}</span>
                <span class="section-count">${items.length}</span>
            </div>
            <md-list class="section-list">
                ${items.map(assignmentItem).join("")}
            </md-list>
        </section>
    `;
}

function renderSections(list) {
    const byDeadline = (a, b) => new Date(a.deadline) - new Date(b.deadline);

    const missing = list.filter(item => statusOf(item) === "missing").sort(byDeadline);
    const upcoming = list.filter(item => statusOf(item) === "pending").sort(byDeadline);
    const submitted = list.filter(item => statusOf(item) === "submitted").sort((a, b) => byDeadline(b, a));

    const sections = [];

    if (missing.length) {
        sections.push(sectionHtml({ title: "Mangler", meta: "Fristen er overskredet", icon: "error", className: "is-missing" }, missing));
    }

    // Kommende grupperet pr. uge
    const weeks = new Map();
    upcoming.forEach(item => {
        const key = getMonday(new Date(item.deadline)).getTime();
        if (!weeks.has(key)) weeks.set(key, []);
        weeks.get(key).push(item);
    });

    weeks.forEach((items, key) => {
        sections.push(sectionHtml(weekHeading(new Date(key)), items));
    });

    if (submitted.length) {
        sections.push(sectionHtml({ title: "Afleveret", meta: "Nyeste først", icon: "task_alt", className: "is-submitted" }, submitted));
    }

    document.querySelector("#sections").innerHTML = sections.join("");
    document.querySelector("#emptyState").hidden = list.length > 0;
}

function render() {
    const list = filteredAssignments();
    renderStats(list);
    renderSections(list);
}

document.querySelector("#sections").addEventListener("click", event => {
    const item = event.target.closest("[data-index]");
    if (item) openAssignment(assignments[Number(item.dataset.index)]);
});


/* ---------- Dialog ---------- */

const dialog = document.querySelector("#assignmentDialog");

// M3: Lists - List item med ikon og overline
// Guide: https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
function detailItem(icon, label, value) {
    if (value === undefined || value === null || value === "") return "";

    return `
        <md-list-item>
            <md-icon slot="start">${icon}</md-icon>
            <div slot="overline">${label}</div>
            <div slot="headline" class="detail-value">${escapeHtml(value)}</div>
        </md-list-item>
    `;
}

function openAssignment(assignment) {
    const status = statusOf(assignment);
    const deadline = new Date(assignment.deadline);

    document.querySelector("#dialogTitle").textContent = assignment.title;

    // M3: Chips - Assist chip
    // Guide: https://m3.material.io/components/chips/overview
    // Element: <md-assist-chip> fra @material/web/chips/assist-chip.js
    document.querySelector("#dialogChips").innerHTML = `
        <md-assist-chip label="${STATUS[status].label}" class="status-chip ${status}">
            <md-icon slot="icon">${STATUS[status].icon}</md-icon>
        </md-assist-chip>
    `;

    document.querySelector("#dialogList").innerHTML = [
        detailItem("groups", "Hold", assignment.subject),
        detailItem("person", "Lærer", assignment.teacher),
        detailItem("event", "Frist", `${formatDeadline(deadline)} (uge ${getWeekNumber(deadline)})`),
        detailItem("hourglass_empty", "Elevtid", assignment.hours !== undefined ? `${formatNumber(assignment.hours)} timer` : ""),
        detailItem("pending_actions", "Afventer", assignment.waitingFor),
        detailItem("person_off", "Fravær", assignment.absence !== undefined ? `${assignment.absence} %` : ""),
        detailItem("grade", "Karakter", assignment.grade),
        detailItem("description", "Opgavenote", assignment.note),
        detailItem("edit_note", "Elevnote", assignment.studentNote)
    ].join("");

    // M3: Dialogs - https://m3.material.io/components/dialogs/overview
    dialog.show();
}

document.querySelector("#dialogClose").addEventListener("click", () => dialog.close());


/* ---------- Data ---------- */

async function loadAssignments() {
    try {
        const data = await apiGet(DATA_URL);
        assignments = data.assignments ?? [];
        subjects = data.subjects ?? [...new Set(assignments.map(item => item.subject))];

        // Vent til M3-komponenterne er klar, og start med filtrene fra HTML'en
        await customElements.whenDefined("md-filter-chip");
        [currentOnly, schoolYearOnly].forEach((chip, index) => {
            chip.selected = initialFilters[index];
        });

        renderTeamChips();
        render();
    } catch (error) {
        document.querySelector("#emptyState").hidden = false;
        document.querySelector("#emptyText").textContent = "Kunne ikke indlæse opgaverne.";
        console.error(error);
    }
}

loadAssignments();
