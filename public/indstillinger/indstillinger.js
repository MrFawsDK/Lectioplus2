// Flexios indstillinger. Alle ændringer gemmes med det samme (saveSettings() i session.js) og bruges straks.

const PAGE_LABELS = {
    "/forside/": "Forside", "/skema/": "Skema", "/studieplan/": "Studieplan", "/fravaer/": "Fravær",
    "/opgaver/": "Opgaver", "/lektier/": "Lektier", "/karakter/": "Karakterer", "/noter/": "Noter",
    "/boger/": "Bøger", "/spoergeskema/": "Spørgeskema", "/dokumenter/": "Dokumenter", "/sps/": "SPS",
    "/beskeder/": "Beskeder"
};

const savedState = document.querySelector("#savedState");
const startSelect = document.querySelector("#startSelect");
const fontSelect = document.querySelector("#fontSelect");
const subjectSelect = document.querySelector("#subjectSelect");
const menuList = document.querySelector("#menuList");

let settings = cachedSettings();
let rendering = false; // true mens vi selv sætter kontrollerne, så det ikke tæller som et valg

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


/* ---------- Gem ---------- */

let savedTimer;

function showSaved(text, isError = false) {
    savedState.textContent = text;
    savedState.style.color = isError ? "var(--md-sys-color-error)" : "";
    savedState.classList.add("show");

    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => savedState.classList.remove("show"), isError ? 4000 : 1500);
}

async function save(patch) {
    try {
        settings = await saveSettings(patch);
        render();
        showSaved("Gemt");
    } catch (error) {
        showSaved(error.message, true);
        render();
    }
}


/* ---------- Visning ---------- */

function selectSegment(set, value) {
    set.querySelectorAll("md-outlined-segmented-button").forEach(button => {
        button.selected = button.dataset.value === value;
    });
}

function fillSelect(select, options, value) {
    // "selected" på valget virker uanset hvornår selecten er tegnet (select.value alene kan komme for tidligt)
    select.innerHTML = options.map(([key, label]) =>
        `<md-select-option value="${escapeHtml(key)}"${key === value ? " selected" : ""}><div slot="headline">${escapeHtml(label)}</div></md-select-option>`).join("");

    select.updateComplete?.then(() => { select.value = value; });
}

function render() {
    rendering = true;

    selectSegment(document.querySelector("#themeSet"), settings.theme);
    selectSegment(document.querySelector("#sizeSet"), settings.textSize);

    document.querySelector("#subjectColorsSwitch").selected = settings.subjectColors !== false;

    document.querySelectorAll("#accentSwatches .swatch").forEach(swatch => {
        swatch.setAttribute("aria-checked", String(swatch.dataset.value === settings.accent));
    });

    // Startsiden kan kun være et menupunkt der ikke er skjult
    const visible = Object.keys(PAGE_LABELS).filter(page => !settings.hiddenMenu.includes(page));
    fillSelect(startSelect, visible.map(page => [page, PAGE_LABELS[page]]), settings.startPage);

    menuList.innerHTML = Object.entries(PAGE_LABELS).map(([page, label]) => `
        <md-list-item>
            <div slot="headline">${escapeHtml(label)}</div>
            <md-switch slot="end" data-page="${escapeHtml(page)}" aria-label="Vis ${escapeHtml(label)}"${settings.hiddenMenu.includes(page) ? "" : " selected"}></md-switch>
        </md-list-item>`).join("");

    // Mindst ét menupunkt skal blive stående
    const on = [...menuList.querySelectorAll("md-switch")].filter(item => item.hasAttribute("selected"));
    if (on.length === 1) on[0].disabled = true;

    if (fontSelect.options?.length) fontSelect.value = settings.noteFont;
    if (subjectSelect.options?.length) subjectSelect.value = settings.noteSubject || "__none";

    queueMicrotask(() => { rendering = false; });
}


/* ---------- Kontroller ---------- */

for (const [id, key] of [["#themeSet", "theme"], ["#sizeSet", "textSize"]]) {
    document.querySelector(id).addEventListener("segmented-button-set-selection", event => {
        if (rendering) return;

        const { button, selected } = event.detail;
        if (!selected) {
            button.selected = true; // der skal altid være ét valg
            return;
        }

        if (button.dataset.value !== settings[key]) save({ [key]: button.dataset.value });
    });
}

document.querySelector("#accentSwatches").addEventListener("click", event => {
    const swatch = event.target.closest(".swatch");
    if (swatch && swatch.dataset.value !== settings.accent) save({ accent: swatch.dataset.value });
});

startSelect.addEventListener("change", () => {
    if (!rendering && startSelect.value !== settings.startPage) save({ startPage: startSelect.value });
});

fontSelect.addEventListener("change", () => {
    if (!rendering && fontSelect.value !== settings.noteFont) save({ noteFont: fontSelect.value });
});

subjectSelect.addEventListener("change", () => {
    if (!rendering && subjectSelect.value !== settings.noteSubject) save({ noteSubject: subjectSelect.value === "__none" ? "" : subjectSelect.value });
});

document.querySelector("#subjectColorsSwitch").addEventListener("change", event => {
    if (!rendering) save({ subjectColors: event.target.selected });
});

menuList.addEventListener("change", event => {
    if (rendering || !event.target.matches("md-switch")) return;

    const hidden = [...menuList.querySelectorAll("md-switch")].filter(item => !item.selected).map(item => item.dataset.page);
    save({ hiddenMenu: hidden });
});


/* ---------- Data og privatliv ---------- */

const dialog = document.querySelector("#deleteDialog");

// Bekræftelse i en M3-dialog: lover true, hvis man trykker på den røde knap
function confirmDialog({ headline, text, confirmLabel }) {
    dialog.querySelector("[slot=headline]").textContent = headline;
    dialog.querySelector("#deleteText").textContent = text;
    dialog.querySelector("#deleteConfirm").textContent = confirmLabel;

    return new Promise(resolve => {
        dialog.addEventListener("closed", () => resolve(dialog.returnValue === "ok"), { once: true });
        dialog.returnValue = "";
        dialog.show();
    });
}

document.querySelector("#deleteCancel").addEventListener("click", () => dialog.close("cancel"));
document.querySelector("#deleteConfirm").addEventListener("click", () => dialog.close("ok"));

async function loadDataSummary() {
    try {
        const { notes, tags } = await apiGet("/api/indstillinger/data");
        document.querySelector("#dataSummary").textContent =
            `Flexio har gemt ${notes} ${notes === 1 ? "note" : "noter"} og ${tags} ${tags === 1 ? "tag" : "tags"} til dig.`;
    } catch {
        document.querySelector("#dataSummary").textContent = "";
    }
}

document.querySelector("#logoutAllButton").addEventListener("click", async () => {
    const ok = await confirmDialog({
        headline: "Log ud overalt?",
        text: "Du bliver logget ud på alle dine enheder, også denne. Du skal bruge en ny Lectio-cookie for at logge ind igen.",
        confirmLabel: "Log ud overalt"
    });
    if (!ok) return;

    try {
        await apiPost("/api/indstillinger/log-ud-overalt");
    } finally {
        location.href = LOGIN_PAGE;
    }
});

document.querySelector("#resetButton").addEventListener("click", async () => {
    try {
        settings = await resetSettings();
        render();
        showSaved("Nulstillet");
    } catch (error) {
        showSaved(error.message, true);
    }
});

document.querySelector("#deleteButton").addEventListener("click", async () => {
    const ok = await confirmDialog({
        headline: "Slet dine Flexio-data?",
        text: "Alle dine noter, tags og indstillinger i Flexio bliver slettet. Det kan ikke fortrydes. Lectio berøres ikke.",
        confirmLabel: "Slet alt"
    });
    if (!ok) return;

    try {
        await apiSend("DELETE", "/api/indstillinger/data", { bekraeft: true });
        settings = await resetSettings();
        render();
        loadDataSummary();
        showSaved("Dine Flexio-data er slettet");
    } catch (error) {
        showSaved(error.message, true);
    }
});


/* ---------- Start ---------- */

async function start() {
    // M3-komponenterne registreres af et modul, der først kører efter dette script - vent på dem, før vi sætter værdier
    await Promise.all(["md-outlined-select", "md-select-option", "md-outlined-segmented-button", "md-switch"]
        .map(name => customElements.whenDefined(name)));

    try {
        const data = await apiGet("/api/indstillinger");
        settings = data.settings;

        fillSelect(fontSelect, data.options.fonts.map(font => [font, font]), settings.noteFont);

        // Fag fra elevens hold i Lectio (samme som på Noter-siden). Kan de ikke hentes, kan man stadig vælge "Intet"
        let subjects = [];
        try {
            subjects = (await apiGet("/api/fag")).subjects ?? [];
        } catch {
            subjects = settings.noteSubject ? [settings.noteSubject] : [];
        }

        const options = [["__none", "Intet"], ...subjects.map(subject => [subject, subject])];
        fillSelect(subjectSelect, options, settings.noteSubject || "__none");
    } catch (error) {
        showSaved(error.message, true);
    }

    render();
    loadDataSummary();
}

start();
