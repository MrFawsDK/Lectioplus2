// Skemaet hentes én uge ad gangen fra vores server, som henter det fra Lectio
const API_URL = "/api/skema";

const DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"];

// Pixels pr. minut
const SCALE = 1.1;

const STATUS = {
    changed: { label: "Ændret", icon: "edit_calendar" },
    cancelled: { label: "Aflyst", icon: "event_busy" }
};

let modules = [];
let lessons = [];

// Noter til lektionerne - hentes fra databasen (samme som på Noter-siden)
let scheduleNotes = [];

// Uger der allerede er hentet: "2026-40" -> true
const loadedWeeks = new Set();

let view = "week";
let selectedDate = startOfDay(new Date());


/* ---------- Datoer og tid ---------- */

function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function getMonday(date) {
    return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

// Weekender springes over i dagsvisning
function nearestWeekday(date, direction = 1) {
    let result = startOfDay(date);
    while (result.getDay() === 0 || result.getDay() === 6) {
        result = addDays(result, direction);
    }
    return result;
}

function toIsoDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

// Årstal for ugen (uge 1 kan starte i december)
function getWeekYear(date) {
    const thursday = startOfDay(date);
    thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
    return thursday.getFullYear();
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

function shortDate(date) {
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

function longDate(date) {
    return date.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });
}

function timeToMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

function formatTime(time) {
    return time.replace(/^0/, "");
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


/* ---------- Placering ---------- */

// Fra første modul/lektion til sidste
function getRange(visibleLessons) {
    const items = [...modules, ...visibleLessons];
    if (items.length === 0) return { start: 8 * 60, end: 16 * 60 };

    return {
        start: Math.min(...items.map(item => timeToMinutes(item.start))),
        end: Math.max(...items.map(item => timeToMinutes(item.end)))
    };
}

// Lektioner der overlapper, vises side om side
function layoutDay(dayLessons) {
    const items = dayLessons
        .map(lesson => ({
            lesson,
            start: timeToMinutes(lesson.start),
            end: timeToMinutes(lesson.end)
        }))
        .sort((a, b) => a.start - b.start || b.end - a.end);

    let group = [];
    let groupEnd = -1;

    function finishGroup() {
        const columnEnds = [];

        group.forEach(item => {
            let column = columnEnds.findIndex(end => end <= item.start);

            if (column === -1) {
                column = columnEnds.length;
                columnEnds.push(0);
            }

            columnEnds[column] = item.end;
            item.column = column;
        });

        group.forEach(item => {
            item.columns = columnEnds.length;
        });

        group = [];
        groupEnd = -1;
    }

    items.forEach(item => {
        if (group.length && item.start >= groupEnd) finishGroup();

        group.push(item);
        groupEnd = Math.max(groupEnd, item.end);
    });

    if (group.length) finishGroup();

    return items;
}


/* ---------- Rendering ---------- */

function createElement(tag, className, html) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (html !== undefined) element.innerHTML = html;
    return element;
}

function renderModuleBands(container, range) {
    modules.forEach(module => {
        const start = timeToMinutes(module.start);
        const end = timeToMinutes(module.end);
        const band = createElement("div", "module-band");

        band.style.top = `${(start - range.start) * SCALE}px`;
        band.style.height = `${(end - start) * SCALE}px`;

        container.appendChild(band);
    });
}

function renderLesson(item, range) {
    const { lesson, start, end, column, columns } = item;
    const status = lesson.status ?? "normal";

    // M3: Cards - Filled card
    // Guide: https://m3.material.io/components/cards/overview
    // Element: <md-filled-card> fra @material/web/labs/card/filled-card.js
    const card = createElement("md-filled-card", `lesson ${status}`);

    card.style.top = `${(start - range.start) * SCALE + 2}px`;
    card.style.height = `${(end - start) * SCALE - 4}px`;
    card.style.left = `calc(${(column / columns) * 100}% + 4px)`;
    card.style.width = `calc(${100 / columns}% - 8px)`;

    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${lesson.subject}, ${lesson.start} til ${lesson.end}`);

    const details = [lesson.teacher, lesson.room].filter(Boolean).join(" · ");
    const icons = [];
    if (STATUS[status]) icons.push(STATUS[status].icon);
    if (lesson.homework) icons.push("menu_book");
    if (notesFor(lesson).length) icons.push("sticky_note_2");

    // M3: States - ripple og focus ring giver kortet tryk- og fokus-tilstand
    // Guide: https://m3.material.io/foundations/interaction/states/overview
    // Element: <md-ripple> og <md-focus-ring> fra @material/web/ripple og /focus
    // Ikoner: <md-icon> (Material Symbols) - https://m3.material.io/styles/icons/overview
    card.innerHTML = `
        <md-ripple></md-ripple>
        <md-focus-ring></md-focus-ring>
        <div class="lesson-inner">
            <div class="lesson-top">
                <span class="lesson-subject">${escapeHtml(lesson.subject)}</span>
                <span class="lesson-icons">${icons.map(icon => `<md-icon>${icon}</md-icon>`).join("")}</span>
            </div>
            <span class="lesson-time">${lesson.start} - ${lesson.end}</span>
            ${details ? `<span class="lesson-details">${escapeHtml(details)}</span>` : ""}
            ${lesson.topic || lesson.note ? `<span class="lesson-details">${escapeHtml((lesson.topic || lesson.note).split("\n")[0])}</span>` : ""}
        </div>
    `;

    card.addEventListener("click", () => openLesson(lesson));
    card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLesson(lesson);
        }
    });

    return card;
}

function visibleDates() {
    if (view === "day") return [selectedDate];

    const monday = getMonday(selectedDate);
    return DAY_NAMES.map((_, index) => addDays(monday, index));
}

function renderTitle(dates) {
    document.querySelector("#weekTitle").textContent = `Uge ${getWeekNumber(dates[0])}`;

    const last = dates[dates.length - 1];
    document.querySelector("#weekRange").textContent = view === "day"
        ? longDate(dates[0])
        : `${shortDate(dates[0])} - ${shortDate(last)} ${last.getFullYear()}`;
}

function renderSchedule() {
    const schedule = document.querySelector("#schedule");
    const dates = visibleDates();
    const isoDates = dates.map(toIsoDate);
    const today = toIsoDate(new Date());

    const visibleLessons = lessons.filter(lesson => isoDates.includes(lesson.date));
    const range = getRange(visibleLessons);

    renderTitle(dates);

    schedule.innerHTML = "";
    schedule.style.setProperty("--days", dates.length);
    schedule.style.setProperty("--body-height", `${(range.end - range.start) * SCALE}px`);

    // Overskrifter
    schedule.appendChild(createElement("div", "corner"));

    dates.forEach((date, index) => {
        const name = DAY_NAMES[(date.getDay() + 6) % 7];
        const header = createElement(
            "div",
            "day-header",
            `<span class="day-name">${name}</span><span class="day-date">${shortDate(date)}</span>`
        );
        if (isoDates[index] === today) header.classList.add("today");
        schedule.appendChild(header);
    });

    // Modulkolonne
    const moduleColumn = createElement("div", "module-column");
    renderModuleBands(moduleColumn, range);

    modules.forEach(module => {
        const info = createElement(
            "div",
            "module-info",
            `<span>${module.name}</span><span class="module-time">${formatTime(module.start)} - ${formatTime(module.end)}</span>`
        );
        info.style.top = `${(timeToMinutes(module.start) - range.start) * SCALE}px`;
        moduleColumn.appendChild(info);
    });

    schedule.appendChild(moduleColumn);

    // Dage
    isoDates.forEach(isoDate => {
        const day = createElement("div", "day");
        renderModuleBands(day, range);

        layoutDay(visibleLessons.filter(lesson => lesson.date === isoDate))
            .forEach(item => day.appendChild(renderLesson(item, range)));

        schedule.appendChild(day);
    });
}


/* ---------- Dialog ---------- */

const dialog = document.querySelector("#lessonDialog");

// M3: Lists - List item med ikon og overline
// Guide: https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
function listItem(icon, label, value) {
    if (!value) return "";

    return `
        <md-list-item>
            <md-icon slot="start">${icon}</md-icon>
            <div slot="overline">${label}</div>
            <div slot="headline">${escapeHtml(value)}</div>
        </md-list-item>
    `;
}

function openLesson(lesson) {
    const [year, month, day] = lesson.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const chips = [];

    // M3: Chips - Assist chip
    // Guide: https://m3.material.io/components/chips/overview
    // Element: <md-assist-chip> fra @material/web/chips/assist-chip.js
    if (STATUS[lesson.status]) {
        const { label, icon } = STATUS[lesson.status];
        chips.push(`<md-assist-chip label="${label}"><md-icon slot="icon">${icon}</md-icon></md-assist-chip>`);
    }

    if (lesson.homework) {
        chips.push(`<md-assist-chip label="Lektier"><md-icon slot="icon">menu_book</md-icon></md-assist-chip>`);
    }

    document.querySelector("#dialogTitle").textContent = lesson.subject;
    document.querySelector("#dialogChips").innerHTML = chips.join("");
    document.querySelector("#dialogChips").hidden = chips.length === 0;

    renderLessonNotes(lesson);

    document.querySelector("#dialogList").innerHTML = [
        listItem("schedule", "Tid", `${longDate(date)}, ${lesson.start} - ${lesson.end}`),
        listItem("person", "Lærer", lesson.teacher),
        listItem("location_on", "Lokale", lesson.room),
        listItem("topic", "Emne", lesson.topic),
        listItem("menu_book", "Lektier", (lesson.homeworkItems ?? []).join("\n")),
        listItem("sticky_note_2", "Note", lesson.note)
    ].join("");

    // M3: Dialogs - https://m3.material.io/components/dialogs/overview
    dialog.show();
}

document.querySelector("#dialogClose").addEventListener("click", () => dialog.close());


/* ---------- Navigation ---------- */

function step(direction) {
    if (view === "day") {
        selectedDate = nearestWeekday(addDays(selectedDate, direction), direction);
    } else {
        selectedDate = addDays(selectedDate, direction * 7);
    }

    showWeek();
}

document.querySelector("#prevButton").addEventListener("click", () => step(-1));
document.querySelector("#nextButton").addEventListener("click", () => step(1));

document.querySelector("#todayButton").addEventListener("click", () => {
    selectedDate = view === "day" ? nearestWeekday(new Date()) : startOfDay(new Date());
    showWeek();
});

// Hændelse fra M3 Segmented button set (@material/web/labs/segmentedbuttonset)
document.querySelector("#viewSwitch").addEventListener("segmented-button-set-selection", event => {
    const { button, selected } = event.detail;

    // Der skal altid være én valgt visning
    if (!selected) {
        button.selected = true;
        return;
    }

    view = button.dataset.view;
    if (view === "day") selectedDate = nearestWeekday(selectedDate);

    showWeek();
});


/* ---------- Data ---------- */

function weekKey(date) {
    return `${getWeekYear(date)}-${getWeekNumber(date)}`;
}

// Hent ugen fra serveren (hvis den ikke allerede er hentet) og vis den
async function showWeek() {
    const key = weekKey(selectedDate);

    if (loadedWeeks.has(key)) {
        renderSchedule();
        return;
    }

    const status = document.querySelector("#scheduleStatus");
    status.textContent = "Henter skema fra Lectio …";
    status.hidden = false;
    renderSchedule();

    try {
        const week = getWeekNumber(selectedDate);
        const year = getWeekYear(selectedDate);
        const data = await apiGet(`${API_URL}?week=${week}&year=${year}`);

        // Kun lektionerne i den hentede uge gemmes for ugen
        const monday = getMonday(selectedDate);
        const weekDates = new Set([0, 1, 2, 3, 4, 5, 6].map(offset => toIsoDate(addDays(monday, offset))));

        lessons = [
            ...lessons.filter(lesson => !weekDates.has(lesson.date)),
            ...(data.lessons ?? []).filter(lesson => weekDates.has(lesson.date))
        ];

        if (data.modules?.length) modules = data.modules;
        loadedWeeks.add(key);

        status.hidden = true;
    } catch (error) {
        status.textContent = `Kunne ikke hente skemaet: ${error.message}`;
        console.error(error);
    }

    // Brugeren kan have skiftet uge imens
    if (weekKey(selectedDate) === key) renderSchedule();
}

/* ---------- Noter til lektionerne ---------- */

function notesFor(lesson) {
    return scheduleNotes.filter(note => note.lesson?.date === lesson.date && note.lesson?.start === lesson.start);
}

function plainText(html) {
    const template = document.createElement("template");
    template.innerHTML = html ?? "";
    return (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
}

// M3: Lists - List item (type="link") - https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
function renderLessonNotes(lesson) {
    const list = notesFor(lesson);

    document.querySelector("#dialogNotes").innerHTML = list
        .map(note => `
            <md-list-item type="link" href="/noter/#note/${encodeURIComponent(note.id)}">
                <md-icon slot="start">sticky_note_2</md-icon>
                <div slot="headline">${escapeHtml(note.title || "Uden titel")}</div>
                <div slot="supporting-text">${escapeHtml(plainText(note.content).slice(0, 80))}</div>
            </md-list-item>
        `)
        .join("");

    document.querySelector("#dialogNotes").hidden = list.length === 0;
    document.querySelector("#dialogNotesEmpty").hidden = list.length > 0;

    // Ny note udfyldes med lektionens dato, tid og fag
    const params = new URLSearchParams({ dato: lesson.date, start: lesson.start, fag: lesson.team || lesson.subject });
    document.querySelector("#newLessonNote").href = `/noter/#ny?${params}`;
}

async function loadScheduleNotes() {
    try {
        scheduleNotes = (await apiGet("/api/noter")).notes ?? [];
        renderSchedule();
    } catch (error) {
        console.error(error);
    }
}

showWeek();
loadScheduleNotes();
