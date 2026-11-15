// Find skema: søg blandt alle elever, lærere, klasser, hold og lokaler. Et tryk åbner deres skema (/skema/?id=...).

const MAX_SHOWN = 60; // så listen ikke bliver tung at tegne - søg for at finde flere

const searchField = document.querySelector("#searchField");
const kinds = document.querySelector("#kinds");
const results = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");

let groups = [];
let kind = "Alle";

// Ikon pr. type, ud fra bogstavet foran id'et (S elev, T lærer, C klasse, HE hold, G gruppe, R lokale)
const ICONS = { S: "person", T: "school", C: "groups", H: "diversity_3", G: "diversity_3", R: "meeting_room" };

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function showEmpty(text) {
    emptyState.hidden = !text;
    results.hidden = Boolean(text);
    document.querySelector("#emptyText").textContent = text ?? "";
}

// Små og store bogstaver og accenter er ligegyldige: "ørsted" finder "Ørsted"
const normalize = text => String(text).toLowerCase();

function renderKinds() {
    kinds.innerHTML = ["Alle", ...groups.map(group => group.title)].map(title => {
        const count = title === "Alle" ? groups.reduce((sum, group) => sum + group.items.length, 0) : groups.find(group => group.title === title).items.length;
        return `<md-filter-chip label="${escapeHtml(title)} (${count})" data-kind="${escapeHtml(title)}"${title === kind ? " selected" : ""}></md-filter-chip>`;
    }).join("");
}

function render() {
    const query = normalize(searchField.value.trim());
    const pool = groups.filter(group => kind === "Alle" || group.title === kind).flatMap(group => group.items.map(item => ({ ...item, group: group.title })));
    const matches = query ? pool.filter(item => normalize(item.name).includes(query)) : pool;

    const shown = matches.slice(0, MAX_SHOWN);

    results.innerHTML = shown.map(item => `
        <md-list-item type="link" href="/skema/?id=${encodeURIComponent(item.id)}">
            <md-icon slot="start">${ICONS[item.id[0]] ?? "person"}</md-icon>
            <div slot="headline">${escapeHtml(item.name)}</div>
            ${kind === "Alle" ? `<div slot="supporting-text">${escapeHtml(item.group)}</div>` : ""}
            <md-icon slot="end">chevron_right</md-icon>
        </md-list-item>`).join("");

    document.querySelector("#count").textContent = matches.length > MAX_SHOWN
        ? `Viser ${MAX_SHOWN} af ${matches.length}. Skriv for at indsnævre.`
        : `${matches.length} ${matches.length === 1 ? "resultat" : "resultater"}`;

    showEmpty(matches.length ? "" : "Ingen fundet.");
}

kinds.addEventListener("click", event => {
    const chip = event.target.closest("[data-kind]");
    if (!chip) return;

    kind = chip.dataset.kind;
    renderKinds();
    render();
});

let timer;
searchField.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
});

async function load() {
    try {
        ({ groups } = await apiGet("/api/find"));
        renderKinds();
        render();
    } catch (error) {
        showEmpty(error.message);
    }
}

load();
