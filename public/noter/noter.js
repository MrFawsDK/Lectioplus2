// Noter og tags gemmes i databasen på serveren (se api/noter.js)
const SCHEDULE_URL = "/api/skema";

// Kun visningen (gruppering, sortering, filtre) gemmes i browseren
const VIEW_KEY = "flexio.noter.visning";

// Noter fra før databasen lå i browseren - de flyttes til databasen første gang
const LEGACY_KEYS = ["flexio.noter", "lectioplus.noter"];

// Autogem: så lang tid efter sidste tastetryk gemmes noten
const AUTOSAVE_MS = 800;

const DAY_NAMES = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

// TAG_COLORS, TAG_ICONS, DEFAULT_TAG_COLOR, DEFAULT_TAG_ICON og tagStyle() kommer fra tags.js

let subjects = [];
let tags = [];
let notes = [];
let lessons = [];

let view = {
    groupBy: "subject",
    sort: "newest",
    subject: "Alle",
    tagIds: [],
    search: ""
};


/* ---------- Browser-lagring ---------- */

function readStorage(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ikke vigtigt hvis visningen ikke kan huskes
    }
}

function saveView() {
    const { groupBy, sort, subject, tagIds } = view;
    writeStorage(VIEW_KEY, { groupBy, sort, subject, tagIds });
}


/* ---------- Hjælpere ---------- */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function parseDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function toIsoDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function getWeekNumber(date) {
    const target = new Date(date);
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    return 1 + Math.round(
        ((target - firstThursday) / 86400000
            - 3 + ((firstThursday.getDay() + 6) % 7)) / 7
    );
}

// Årstal for ugen (uge 1 kan starte i december)
function getWeekYear(date) {
    const thursday = new Date(date);
    thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
    return thursday.getFullYear();
}

function shortDate(isoDate) {
    const date = parseDate(isoDate);
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

function longDate(isoDate) {
    const date = parseDate(isoDate);
    return date.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Lektioner hentes pr. uge fra skemaet, når der er brug for dem
const loadedLessonWeeks = new Map();

function weekKeyOf(isoDate) {
    const date = parseDate(isoDate);
    return `${getWeekYear(date)}-${getWeekNumber(date)}`;
}

async function loadLessonWeek(isoDate) {
    const key = weekKeyOf(isoDate);
    if (!loadedLessonWeeks.has(key)) {
        const date = parseDate(isoDate);
        const request = apiGet(`${SCHEDULE_URL}?week=${getWeekNumber(date)}&year=${getWeekYear(date)}`)
            .then(data => {
                const weekLessons = (data.lessons ?? []).filter(lesson => weekKeyOf(lesson.date) === key);
                lessons = [...lessons.filter(lesson => weekKeyOf(lesson.date) !== key), ...weekLessons];
            })
            .catch(error => {
                console.error(error);
                loadedLessonWeeks.delete(key);
            });

        loadedLessonWeeks.set(key, request);
    }

    return loadedLessonWeeks.get(key);
}

function findLesson(ref) {
    if (!ref) return null;
    return lessons.find(lesson => lesson.date === ref.date && lesson.start === ref.start) ?? null;
}

function lessonLabel(ref) {
    const lesson = findLesson(ref);
    const day = DAY_NAMES[parseDate(ref.date).getDay()];
    const time = lesson ? `${lesson.start}-${lesson.end}` : ref.start;
    const subject = lesson ? `${lesson.subject} · ` : "";
    return `${subject}${day} ${shortDate(ref.date)} kl. ${time}`;
}

function findTag(id) {
    return tags.find(tag => tag.id === id);
}

function tagsOf(note) {
    return (note.tags ?? []).map(findTag).filter(Boolean);
}

// Indholdet i databasen er HTML fra editoren
function noteHtml(note) {
    return note.content ?? "";
}

function noteText(note) {
    return htmlToText(note.content ?? "");
}

function noteTitle(note) {
    return note.title || "Uden titel";
}

function sortedTags() {
    return [...tags].sort((a, b) => a.name.localeCompare(b.name, "da"));
}


/* ---------- Noter fra før databasen ---------- */

// Ældre noter lå i browseren og havde måske "topics" (tekst) i stedet for tags. De laves om til tags.
function legacyData() {
    const key = LEGACY_KEYS.find(name => readStorage(name)?.notes?.length || readStorage(name)?.tags?.length);
    if (!key) return null;

    const data = readStorage(key);
    const legacyTags = [...(data.tags ?? [])];
    const colorKeys = Object.keys(TAG_COLORS);

    function tagIdForName(name) {
        const existing = legacyTags.find(tag => tag.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;

        const tag = { id: `topic-${legacyTags.length}`, name, color: colorKeys[legacyTags.length % colorKeys.length], icon: DEFAULT_TAG_ICON };
        legacyTags.push(tag);
        return tag.id;
    }

    const legacyNotes = (data.notes ?? []).map(note => {
        const { topics, ...rest } = note;
        return { ...rest, tags: note.tags ?? (topics ?? []).map(tagIdForName) };
    });

    return { key, notes: legacyNotes, tags: legacyTags };
}

// Flyt gamle noter til databasen (kun hvis databasen er tom for eleven). De gamle data gemmes som backup.
async function importLegacyNotes() {
    const legacy = legacyData();
    if (!legacy) return;

    const imported = await apiSend("POST", "/api/noter/import", { notes: legacy.notes, tags: legacy.tags });
    notes = imported.notes;
    tags = imported.tags;

    try {
        localStorage.setItem(`${legacy.key}.backup`, localStorage.getItem(legacy.key));
        LEGACY_KEYS.forEach(name => localStorage.removeItem(name));
    } catch {
        // Ikke vigtigt
    }
}


/* ---------- Filtrering og sortering ---------- */

function visibleNotes() {
    const search = view.search.trim().toLowerCase();

    return notes.filter(note => {
        if (view.subject !== "Alle" && note.subject !== view.subject) return false;

        // Noten skal have mindst ét af de valgte tags
        if (view.tagIds.length && !view.tagIds.some(id => note.tags?.includes(id))) return false;

        if (!search) return true;

        const haystack = [note.title, noteText(note), note.subject, ...tagsOf(note).map(tag => tag.name)]
            .join(" ")
            .toLowerCase();

        return haystack.includes(search);
    });
}

function compareNotes(a, b) {
    if (view.sort === "title") return noteTitle(a).localeCompare(noteTitle(b), "da");
    if (view.sort === "updated") return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

    const byDate = a.date.localeCompare(b.date) || (a.lesson?.start ?? "").localeCompare(b.lesson?.start ?? "");
    return view.sort === "oldest" ? byDate : -byDate;
}


/* ---------- Gruppering ---------- */

const LAST = "￿";

// Hver gruppe: { key, title, meta, order, tag }
function groupsFor(note) {
    const date = parseDate(note.date);

    switch (view.groupBy) {
        case "subject":
            return [{ key: note.subject, title: note.subject, order: note.subject }];

        case "tag": {
            const noteTags = tagsOf(note);
            if (!noteTags.length) return [{ key: LAST, title: "Uden tag", order: LAST }];
            return noteTags.map(tag => ({ key: tag.id, title: tag.name, order: tag.name.toLowerCase(), tag }));
        }

        case "week": {
            const week = getWeekNumber(date);
            const year = getWeekYear(date);
            const key = `${year}-${String(week).padStart(2, "0")}`;
            return [{ key, title: `Uge ${week}`, meta: String(year), order: key }];
        }

        case "date":
            return [{ key: note.date, title: longDate(note.date), order: note.date }];

        case "lesson":
            if (!note.lesson) return [{ key: LAST, title: "Uden lektion", order: LAST }];
            return [{
                key: `${note.lesson.date} ${note.lesson.start}`,
                title: lessonLabel(note.lesson),
                order: `${note.lesson.date} ${note.lesson.start}`
            }];

        default:
            return [{ key: "all", title: "", order: "" }];
    }
}

function buildGroups(list) {
    const groups = new Map();

    list.forEach(note => {
        groupsFor(note).forEach(group => {
            if (!groups.has(group.key)) groups.set(group.key, { ...group, notes: [] });
            groups.get(group.key).notes.push(note);
        });
    });

    // Tidsbaserede grupper følger sorteringen, resten er alfabetiske. "Uden ..." står sidst.
    const timeBased = ["week", "date", "lesson"].includes(view.groupBy);
    const descending = timeBased && view.sort === "newest";

    return [...groups.values()]
        .sort((a, b) => {
            if (a.key === LAST) return 1;
            if (b.key === LAST) return -1;
            const result = String(a.order).localeCompare(String(b.order), "da");
            return descending ? -result : result;
        })
        .map(group => ({ ...group, notes: group.notes.sort(compareNotes) }));
}


/* ---------- Tags som chips ---------- */

// M3: Chips - Assist chip med ikon, farvet efter tagget
// Guide: https://m3.material.io/components/chips/overview
// Element: <md-assist-chip> fra @material/web/chips/assist-chip.js
function tagChip(tag) {
    return `
        <md-assist-chip class="tag-chip" label="${escapeHtml(tag.name)}" data-tag-id="${escapeHtml(tag.id)}" style="${tagStyle(tag)}">
            <md-icon slot="icon">${tag.icon}</md-icon>
        </md-assist-chip>
    `;
}

// M3: Chips - Filter chip med ikon, farvet efter tagget
// Guide: https://m3.material.io/components/chips/overview
// Element: <md-filter-chip> fra @material/web/chips/filter-chip.js
function tagFilterChip(tag, selected, count) {
    const label = count === undefined ? tag.name : `${tag.name} (${count})`;
    return `
        <md-filter-chip class="tag-filter" label="${escapeHtml(label)}" data-tag-id="${escapeHtml(tag.id)}" style="${tagStyle(tag)}"${selected ? " selected" : ""}>
            <md-icon slot="icon">${tag.icon}</md-icon>
        </md-filter-chip>
    `;
}


/* ---------- Rendering af siden ---------- */

function renderSubjectChips() {
    const chipSet = document.querySelector("#subjectChips");

    // M3: Chips - Filter chip
    // Guide: https://m3.material.io/components/chips/overview
    // Element: <md-filter-chip> fra @material/web/chips/filter-chip.js
    chipSet.innerHTML = ["Alle", ...subjects]
        .map(subject => {
            const count = subject === "Alle" ? notes.length : notes.filter(note => note.subject === subject).length;
            const selected = subject === view.subject ? " selected" : "";
            const label = subject === "Alle" ? `Alle fag (${count})` : `${subject} (${count})`;
            return `<md-filter-chip label="${escapeHtml(label)}" data-subject="${escapeHtml(subject)}"${selected}></md-filter-chip>`;
        })
        .join("");

    chipSet.querySelectorAll("[data-subject]").forEach(chip => {
        chip.addEventListener("click", () => {
            view.subject = chip.dataset.subject;
            saveView();
            renderSubjectChips();
            renderNotes();
        });
    });
}

function renderTagFilterChips() {
    const chipSet = document.querySelector("#tagFilterChips");

    chipSet.innerHTML = sortedTags()
        .map(tag => tagFilterChip(tag, view.tagIds.includes(tag.id), notes.filter(note => note.tags?.includes(tag.id)).length))
        .join("");

    chipSet.hidden = tags.length === 0;

    chipSet.querySelectorAll("[data-tag-id]").forEach(chip => {
        chip.addEventListener("click", () => toggleTagFilter(chip.dataset.tagId));
    });
}

function toggleTagFilter(id) {
    view.tagIds = view.tagIds.includes(id)
        ? view.tagIds.filter(tagId => tagId !== id)
        : [...view.tagIds, id];

    saveView();
    renderTagFilterChips();
    renderNotes();
}

// M3: Cards - Outlined card (klikbar med ripple og focus ring)
// Guide: https://m3.material.io/components/cards/overview
// Element: <md-outlined-card> fra @material/web/labs/card/outlined-card.js
//          <md-ripple> og <md-focus-ring> - https://m3.material.io/foundations/interaction/states/overview
function noteCard(note) {
    // Vis kun de oplysninger der ikke allerede står i gruppens overskrift
    const meta = [];
    if (view.groupBy !== "subject") meta.push(note.subject);
    if (view.groupBy !== "date" && view.groupBy !== "lesson") meta.push(`${DAY_NAMES[parseDate(note.date).getDay()]} ${shortDate(note.date)}`);
    if (view.groupBy !== "lesson" && note.lesson) {
        const lesson = findLesson(note.lesson);
        meta.push(`kl. ${lesson ? `${lesson.start}-${lesson.end}` : note.lesson.start}`);
    }

    const noteTags = tagsOf(note).sort((a, b) => a.name.localeCompare(b.name, "da"));

    return `
        <md-outlined-card class="note-card" data-id="${escapeHtml(note.id)}" tabindex="0" role="button" aria-label="${escapeHtml(noteTitle(note))}">
            <md-ripple></md-ripple>
            <md-focus-ring></md-focus-ring>
            <div class="note-inner">
                <span class="note-meta">${meta.map(escapeHtml).join(" · ")}</span>
                <h3 class="note-title">${escapeHtml(noteTitle(note))}</h3>
                <p class="note-content">${escapeHtml(noteText(note))}</p>
                ${noteTags.length ? `<md-chip-set class="note-tags">${noteTags.map(tagChip).join("")}</md-chip-set>` : ""}
            </div>
        </md-outlined-card>
    `;
}

function groupHead(group) {
    if (!group.title) return "";

    const icon = group.tag
        ? `<span class="group-tag-icon" style="${tagStyle(group.tag)}"><md-icon>${group.tag.icon}</md-icon></span>`
        : "";

    return `
        <div class="group-head">
            ${icon}
            <h2>${escapeHtml(group.title)}</h2>
            ${group.meta ? `<span class="group-meta">${escapeHtml(group.meta)}</span>` : ""}
            <span class="group-count">${group.notes.length}</span>
        </div>
    `;
}

function renderNotes() {
    const list = visibleNotes();
    const groups = buildGroups(list);

    document.querySelector("#groups").innerHTML = groups
        .map(group => `
            <section class="group">
                ${groupHead(group)}
                <div class="note-grid">${group.notes.map(noteCard).join("")}</div>
            </section>
        `)
        .join("");

    document.querySelector("#emptyState").hidden = list.length > 0;
    document.querySelector("#emptyText").textContent = notes.length === 0
        ? "Ingen noter endnu. Tryk på \"Ny note\" for at skrive den første."
        : "Ingen noter matcher dine valg.";

    const subjectCount = new Set(notes.map(note => note.subject)).size;
    document.querySelector("#lead").textContent =
        `${notes.length} ${notes.length === 1 ? "note" : "noter"} i ${subjectCount} fag · ${tags.length} tags`
        + (list.length !== notes.length ? ` · viser ${list.length}` : "");
}

function renderAll() {
    renderSubjectChips();
    renderTagFilterChips();
    renderNotes();
}

const groupsElement = document.querySelector("#groups");

groupsElement.addEventListener("click", event => {
    // Klik på et tag i et kort filtrerer på tagget
    const tagElement = event.target.closest("[data-tag-id]");
    if (tagElement) {
        toggleTagFilter(tagElement.dataset.tagId);
        return;
    }

    const card = event.target.closest(".note-card");
    if (card) openNote(card.dataset.id);
});

groupsElement.addEventListener("keydown", event => {
    const card = event.target.closest?.(".note-card");
    if (card && event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openNote(card.dataset.id);
    }
});


/* ---------- Visning ---------- */

const searchField = document.querySelector("#searchField");
const groupSelect = document.querySelector("#groupSelect");
const sortSelect = document.querySelector("#sortSelect");

// Hændelser fra M3 Text field og M3 Select
searchField.addEventListener("input", () => {
    view.search = searchField.value;
    renderNotes();
});

groupSelect.addEventListener("change", () => {
    view.groupBy = groupSelect.value || view.groupBy;
    saveView();
    renderNotes();
});

sortSelect.addEventListener("change", () => {
    view.sort = sortSelect.value || view.sort;
    saveView();
    renderNotes();
});


/* ---------- Editor: ny / ret note ---------- */

// createRichEditor(), sanitizeHtml(), htmlToText() og textToHtml() kommer fra editor.js

const editor = document.querySelector("#noteEditor");
const listView = document.querySelector(".noter-page");
const fab = document.querySelector("#newNoteButton");
const titleField = document.querySelector("#titleField");
const subjectField = document.querySelector("#subjectField");
const dateField = document.querySelector("#dateField");
const lessonField = document.querySelector("#lessonField");
const saveState = document.querySelector("#saveState");

let editingNoteId = null;
let noteTagSelection = new Set();

const richEditor = createRichEditor({
    page: document.querySelector("#notePage"),
    toolbar: document.querySelector("#formatBar"),
    onChange: () => {
        scheduleSave();
        updateCounts();
    }
});


/* ---------- Autogem ---------- */

let saveTimer = null;
let pendingChanges = false;
let saving = Promise.resolve();
let saveInFlight = false;

function setSaveState(text, type = "") {
    saveState.textContent = text;
    saveState.className = `save-state ${type}`;
}

// Kaldes ved hver ændring - gemmer når man har holdt en lille pause
function scheduleSave() {
    pendingChanges = true;
    setSaveState("Gemmer …", "unsaved");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_MS);
}

function collectNote() {
    const date = dateField.value || toIsoDate(new Date());
    const lessonStart = lessonField.value;

    return {
        title: titleField.value.trim(),
        subject: subjectField.value || subjects[0] || "",
        date,
        lesson: lessonStart ? { date, start: lessonStart } : null,
        tags: [...noteTagSelection].filter(id => findTag(id)),
        content: richEditor.getHtml()
    };
}

function upsertNote(saved) {
    const index = notes.findIndex(note => note.id === saved.id);
    if (index >= 0) notes[index] = saved;
    else notes.push(saved);
}

// Gem nu (venter på evt. igangværende gem, så rækkefølgen holdes)
function saveNow() {
    clearTimeout(saveTimer);
    if (!pendingChanges) return saving;

    pendingChanges = false;
    const data = collectNote();

    // En ny, tom note gemmes ikke
    if (!editingNoteId && !data.title && !richEditor.getText().trim()) {
        setSaveState("");
        return saving;
    }

    saving = saving.then(async () => {
        saveInFlight = true;

        try {
            const saved = editingNoteId
                ? await apiSend("PUT", `/api/noter/${encodeURIComponent(editingNoteId)}`, data)
                : await apiSend("POST", "/api/noter", data);

            if (!editingNoteId) {
                // Den nye note har nu et id - adressen opdateres uden at åbne noten igen
                editingNoteId = saved.id;
                history.replaceState(null, "", `#note/${encodeURIComponent(saved.id)}`);
                document.querySelector("#deleteButton").hidden = false;
            }

            upsertNote(saved);
            if (!pendingChanges) setSaveState("Gemt");
        } catch (error) {
            console.error(error);
            pendingChanges = true;
            setSaveState("Kunne ikke gemme - prøver igen …", "error");
            saveTimer = setTimeout(saveNow, 3000);
        } finally {
            saveInFlight = false;
        }
    });

    return saving;
}

// Ordtælling i statuslinjen
function updateCounts() {
    const text = richEditor.getText();
    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.replace(/\n/g, "").length;

    document.querySelector("#wordCount").textContent = `${words} ord`;
    document.querySelector("#charCount").textContent = `${chars} tegn`;
}

// M3: Select option - https://m3.material.io/components/menus/overview
// Element: <md-select-option> fra @material/web/select/select-option.js
function option(value, label, selected) {
    return `<md-select-option value="${escapeHtml(value)}"${selected ? " selected" : ""}>
        <div slot="headline">${escapeHtml(label)}</div>
    </md-select-option>`;
}

function renderSubjectOptions(selected) {
    // Notens fag vises altid, også hvis det ikke længere er på listen fra Lectio
    const list = selected && !subjects.includes(selected) ? [selected, ...subjects] : subjects;
    subjectField.innerHTML = list.map(subject => option(subject, subject, subject === selected)).join("");
}

// Lektionerne fra skemaet på den valgte dato
function renderLessonOptions(date, selectedStart) {
    const dayLessons = lessons
        .filter(lesson => lesson.date === date)
        .sort((a, b) => a.start.localeCompare(b.start));

    lessonField.innerHTML = [
        option("", dayLessons.length ? "Ingen lektion" : "Ingen lektioner i skemaet denne dag", !selectedStart),
        ...dayLessons.map(lesson => option(lesson.start, `${lesson.start}-${lesson.end} ${lesson.subject}`, lesson.start === selectedStart))
    ].join("");
}

function renderNoteTagChips() {
    const chipSet = document.querySelector("#noteTagChips");

    chipSet.innerHTML = tags.length
        ? sortedTags().map(tag => tagFilterChip(tag, noteTagSelection.has(tag.id))).join("")
        : `<span class="empty-small">Ingen tags endnu - lav et med "Nyt tag".</span>`;

    chipSet.querySelectorAll("[data-tag-id]").forEach(chip => {
        chip.addEventListener("click", () => {
            const id = chip.dataset.tagId;
            if (noteTagSelection.has(id)) noteTagSelection.delete(id);
            else noteTagSelection.add(id);
            scheduleSave();
        });
    });
}

dateField.addEventListener("change", async () => {
    renderLessonOptions(dateField.value, "");
    scheduleSave();

    if (dateField.value) {
        await loadLessonWeek(dateField.value);
        renderLessonOptions(dateField.value, lessonField.value);
    }
});

titleField.addEventListener("input", scheduleSave);
subjectField.addEventListener("change", scheduleSave);
lessonField.addEventListener("change", scheduleSave);


/* ---------- Åbn og luk editoren ---------- */

// Editoren styres af adressen, så tilbage-knappen virker:
//   #note/<id>                          åbn en note
//   #ny                                 ny note
//   #ny?dato=2026-09-28&start=08:00&fag=2y MaB/A   ny note til en lektion (fra Skema)
let openedFromList = false;

function openNote(id) {
    openedFromList = true;
    location.hash = id ? `#note/${encodeURIComponent(id)}` : "#ny";
}

async function closeEditor() {
    await saveNow();

    if (openedFromList) {
        openedFromList = false;
        history.back();
    } else {
        history.replaceState(null, "", location.pathname + location.search);
        route();
    }
}

function route() {
    const hash = location.hash;

    if (hash === "#ny" || hash.startsWith("#ny?")) {
        const params = new URLSearchParams(hash.slice(4));
        showEditor(null, {
            date: params.get("dato"),
            start: params.get("start"),
            subject: params.get("fag")
        });
    } else if (hash.startsWith("#note/")) {
        const id = decodeURIComponent(hash.slice("#note/".length));
        if (id === editingNoteId && !editor.hidden) return; // allerede åben (fx lige efter første autogem)
        if (notes.some(note => note.id === id)) showEditor(id);
        else hideEditor();
    } else {
        hideEditor();
    }
}

function hideEditor() {
    // Gem det sidste, hvis man fx har brugt browserens tilbage-knap
    saveNow().then(renderAll);

    editingNoteId = null;
    editor.hidden = true;
    listView.hidden = false;
    fab.hidden = false;
    setSaveState("");
}

function showEditor(id, prefill = {}) {
    const note = notes.find(item => item.id === id);
    editingNoteId = note ? note.id : null;
    noteTagSelection = new Set(note?.tags ?? view.tagIds);
    pendingChanges = false;

    const date = note?.date ?? (prefill.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : toIsoDate(new Date()));
    const subject = note?.subject ?? prefill.subject ?? (view.subject !== "Alle" ? view.subject : subjects[0]);
    const lessonStart = note?.lesson?.start ?? prefill.start ?? "";

    document.querySelector("#deleteButton").hidden = !note;

    titleField.value = note?.title ?? "";
    dateField.value = date;
    richEditor.setHtml(note ? noteHtml(note) : "");

    renderSubjectOptions(subject);
    renderLessonOptions(date, lessonStart);
    loadLessonWeek(date).then(() => {
        if (!editor.hidden) renderLessonOptions(dateField.value, lessonField.value || lessonStart);
    });
    renderNoteTagChips();

    listView.hidden = true;
    fab.hidden = true;
    editor.hidden = false;
    window.scrollTo(0, 0);

    // Formateringslinjen klæber under den øverste linje
    editor.style.setProperty("--bar-height", `${document.querySelector(".editor-bar").offsetHeight}px`);

    updateCounts();
    setSaveState(note ? "Gemt" : "");

    if (note) richEditor.focus();
    else titleField.focus();
}

async function deleteNote() {
    if (!editingNoteId) return;

    clearTimeout(saveTimer);
    pendingChanges = false;
    await saving;

    await apiSend("DELETE", `/api/noter/${encodeURIComponent(editingNoteId)}`);
    notes = notes.filter(note => note.id !== editingNoteId);
    renderAll();
    closeEditor();
}

document.querySelector("#newNoteButton").addEventListener("click", () => openNote(null));
document.querySelector("#backButton").addEventListener("click", closeEditor);
document.querySelector("#deleteButton").addEventListener("click", deleteNote);
document.querySelector("#noteNewTagButton").addEventListener("click", () => openTagEditor(null, "note"));

window.addEventListener("hashchange", route);

// Advar hvis siden lukkes, før det sidste er gemt
window.addEventListener("beforeunload", event => {
    if (pendingChanges || saveInFlight) {
        saveNow();
        event.preventDefault();
    }
});

// Ctrl+S / Cmd+S gemmer med det samme, Esc går tilbage til noterne
document.addEventListener("keydown", event => {
    if (editor.hidden) return;

    const dialogOpen = document.querySelector("md-dialog[open]");

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!dialogOpen) {
            pendingChanges = true;
            saveNow();
        }
    } else if (event.key === "Escape" && !dialogOpen) {
        closeEditor();
    }
});


/* ---------- Dialog: oversigt over tags ---------- */

const tagsDialog = document.querySelector("#tagsDialog");

// M3: Lists - List item med farvet ikon og knapper
// Guide: https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
// Knapper: <md-icon-button> - https://m3.material.io/components/icon-buttons/overview
function renderTagList() {
    const list = document.querySelector("#tagList");

    list.innerHTML = sortedTags()
        .map(tag => {
            const count = notes.filter(note => note.tags?.includes(tag.id)).length;
            return `
                <md-list-item>
                    <span slot="start" class="tag-avatar" style="${tagStyle(tag)}"><md-icon>${tag.icon}</md-icon></span>
                    <div slot="headline">${escapeHtml(tag.name)}</div>
                    <div slot="supporting-text">${count} ${count === 1 ? "note" : "noter"}</div>
                    <div slot="end" class="tag-actions">
                        <md-icon-button data-edit-tag="${escapeHtml(tag.id)}" aria-label="Ret ${escapeHtml(tag.name)}">
                            <md-icon>edit</md-icon>
                        </md-icon-button>
                        <md-icon-button data-delete-tag="${escapeHtml(tag.id)}" aria-label="Slet ${escapeHtml(tag.name)}">
                            <md-icon>delete</md-icon>
                        </md-icon-button>
                    </div>
                </md-list-item>
            `;
        })
        .join("");

    list.hidden = tags.length === 0;
    document.querySelector("#tagListEmpty").hidden = tags.length > 0;
}

document.querySelector("#tagList").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-tag]");
    if (edit) {
        openTagEditor(edit.dataset.editTag, "manager");
        return;
    }

    const remove = event.target.closest("[data-delete-tag]");
    if (remove) deleteTag(remove.dataset.deleteTag);
});

async function deleteTag(id) {
    await apiSend("DELETE", `/api/tags/${encodeURIComponent(id)}`);

    tags = tags.filter(tag => tag.id !== id);
    notes = notes.map(note => ({ ...note, tags: (note.tags ?? []).filter(tagId => tagId !== id) }));
    view.tagIds = view.tagIds.filter(tagId => tagId !== id);
    noteTagSelection.delete(id);

    saveView();
    renderTagList();
    renderAll();
}

document.querySelector("#manageTagsButton").addEventListener("click", () => {
    renderTagList();
    tagsDialog.show();
});

document.querySelector("#newTagButton").addEventListener("click", () => openTagEditor(null, "manager"));
document.querySelector("#closeTagsButton").addEventListener("click", () => tagsDialog.close());


/* ---------- Dialog: nyt / ret tag ---------- */

const tagDialog = document.querySelector("#tagDialog");
const tagNameField = document.querySelector("#tagNameField");

let editingTagId = null;
let tagDraft = { name: "", color: DEFAULT_TAG_COLOR, icon: DEFAULT_TAG_ICON };
let tagEditorFrom = "manager";

function renderTagPreview() {
    const preview = { ...tagDraft, name: tagDraft.name.trim() || "Nyt tag" };
    document.querySelector("#tagPreview").innerHTML = `<md-chip-set>${tagChip(preview)}</md-chip-set>`;
}

// Farvevælger: almindelige knapper, da M3 ikke har en farvevælger
function renderColorPicker() {
    document.querySelector("#colorPicker").innerHTML = Object.entries(TAG_COLORS)
        .map(([key, color]) => `
            <button type="button" class="swatch${key === tagDraft.color ? " selected" : ""}" data-color="${key}"
                role="radio" aria-checked="${key === tagDraft.color}" aria-label="${color.name}" title="${color.name}"
                style="--swatch: ${color.main}; --swatch-container: ${color.container};">
                ${key === tagDraft.color ? `<md-icon>check</md-icon>` : ""}
            </button>
        `)
        .join("");
}

// M3: Icon buttons - Toggle icon button (valgt ikon er "selected")
// Guide: https://m3.material.io/components/icon-buttons/overview
// Element: <md-icon-button toggle selected> fra @material/web/iconbutton/icon-button.js
function renderIconPicker() {
    document.querySelector("#iconPicker").innerHTML = TAG_ICONS
        .map(icon => `
            <md-icon-button toggle data-icon="${icon}" aria-label="${icon}" title="${icon}"${icon === tagDraft.icon ? " selected" : ""}>
                <md-icon>${icon}</md-icon>
                <md-icon slot="selected">${icon}</md-icon>
            </md-icon-button>
        `)
        .join("");
}

function renderTagEditor() {
    renderTagPreview();
    renderColorPicker();
    renderIconPicker();
}

document.querySelector("#colorPicker").addEventListener("click", event => {
    const swatch = event.target.closest("[data-color]");
    if (!swatch) return;

    tagDraft.color = swatch.dataset.color;
    renderTagEditor();
});

document.querySelector("#iconPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-icon]");
    if (!button) return;

    tagDraft.icon = button.dataset.icon;
    renderTagEditor();
});

tagNameField.addEventListener("input", () => {
    tagDraft.name = tagNameField.value;
    tagNameField.error = false;
    renderTagPreview();
});

function openTagEditor(id, from) {
    const tag = findTag(id);
    editingTagId = tag ? tag.id : null;
    tagEditorFrom = from;

    tagDraft = tag
        ? { name: tag.name, color: tag.color, icon: tag.icon }
        : { name: "", color: DEFAULT_TAG_COLOR, icon: DEFAULT_TAG_ICON };

    document.querySelector("#tagDialogTitle").textContent = tag ? "Ret tag" : "Nyt tag";
    tagNameField.value = tagDraft.name;
    tagNameField.error = false;

    renderTagEditor();

    // M3: Dialogs - https://m3.material.io/components/dialogs/overview
    tagDialog.show();
}

async function saveTag() {
    const name = tagNameField.value.trim();
    const duplicate = tags.some(tag => tag.id !== editingTagId && tag.name.toLowerCase() === name.toLowerCase());

    if (!name || duplicate) {
        tagNameField.error = true;
        tagNameField.errorText = name ? "Der findes allerede et tag med det navn" : "Skriv et navn";
        tagNameField.focus();
        return;
    }

    const fields = { name, color: tagDraft.color, icon: tagDraft.icon };

    let tag;
    try {
        tag = editingTagId
            ? await apiSend("PUT", `/api/tags/${encodeURIComponent(editingTagId)}`, fields)
            : await apiSend("POST", "/api/tags", fields);
    } catch (error) {
        tagNameField.error = true;
        tagNameField.errorText = error.message;
        return;
    }

    tags = editingTagId
        ? tags.map(item => (item.id === editingTagId ? tag : item))
        : [...tags, tag];

    renderAll();

    if (tagEditorFrom === "note") {
        // Nyt tag fra noten vælges med det samme på noten
        if (!editingTagId) {
            noteTagSelection.add(tag.id);
            scheduleSave();
        }
        renderNoteTagChips();
    } else {
        renderTagList();
    }

    tagDialog.close();
}

document.querySelector("#saveTagButton").addEventListener("click", saveTag);
document.querySelector("#cancelTagButton").addEventListener("click", () => tagDialog.close());

document.querySelector("#tagForm").addEventListener("submit", event => {
    event.preventDefault();
    saveTag();
});


/* ---------- Data ---------- */

async function loadNotes() {
    try {
        const data = await apiGet("/api/noter");
        notes = data.notes ?? [];
        tags = data.tags ?? [];

        if (notes.length === 0 && tags.length === 0) await importLegacyNotes();

        // Fag fra elevens hold i Lectio (+ fag der allerede bruges i noter)
        try {
            subjects = (await apiGet("/api/fag")).subjects ?? [];
        } catch (error) {
            console.error(error);
            subjects = [...new Set(notes.map(note => note.subject).filter(Boolean))];
        }

        // Lektionerne bruges til at koble noter til skemaet - hent de uger noterne peger på
        const lessonDates = [...new Set(notes.filter(note => note.lesson).map(note => note.lesson.date))];
        const weeks = new Map(lessonDates.map(date => [weekKeyOf(date), date]));
        await Promise.all([...weeks.values()].map(loadLessonWeek));

        const savedView = readStorage(VIEW_KEY) ?? readStorage("lectioplus.noter.visning");
        if (savedView) view = { ...view, ...savedView, search: "" };
        if (view.groupBy === "topic") view.groupBy = "tag";
        if (view.subject !== "Alle" && !subjects.includes(view.subject)) view.subject = "Alle";
        view.tagIds = (view.tagIds ?? []).filter(id => findTag(id));

        // Vent til M3-komponenterne er klar, før valgene sættes
        await Promise.all(["md-outlined-select", "md-filter-chip"].map(tag => customElements.whenDefined(tag)));
        groupSelect.value = view.groupBy;
        sortSelect.value = view.sort;

        renderAll();
        route();
    } catch (error) {
        document.querySelector("#emptyState").hidden = false;
        document.querySelector("#emptyText").textContent = "Kunne ikke indlæse noterne.";
        console.error(error);
    }
}

loadNotes();
