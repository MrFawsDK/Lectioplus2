// Find: den hele liste over elever, lærere, klasser, hold og lokaler - som i Lectio, sorteret og delt op efter bogstav.
// Et tryk på en elev eller lærer åbner profilen (/person/?id=...), andre går direkte til skemaet (/skema/?id=...).
// Store lister (hundredvis af elever) tegnes i bidder, mens man ruller, så siden ikke bliver tung.

const CHUNK = 120; // så mange rækker tegnes ad gangen

const searchField = document.querySelector("#searchField");
const kinds = document.querySelector("#kinds");
const results = document.querySelector("#results");
const alphabet = document.querySelector("#alphabet");
const emptyState = document.querySelector("#emptyState");
const sentinel = document.querySelector("#sentinel");

let groups = [];
let kind = "Alle";
let sections = [];   // [{ letter, items }] efter søgning og type
let drawn = 0;       // hvor mange sektioner der er tegnet

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
    document.querySelector("#emptyText").textContent = text ?? "";
}

const normalize = text => String(text).toLowerCase();

// Navn og klasse fra Lectios tekst: "Anna Hansen (2y 25htx)" -> Anna Hansen + 2y 25htx, "ABD - Anders Dahl" -> Anders Dahl + ABD
function describe(item, groupTitle) {
    const student = item.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (student) return { ...item, group: groupTitle, display: student[1], sub: student[2] };

    const teacher = item.name.match(/^([A-ZÆØÅa-zæøå]{2,6})\s+-\s+(.+)$/);
    if (teacher && item.id.startsWith("T")) return { ...item, group: groupTitle, display: teacher[2], sub: teacher[1] };

    return { ...item, group: groupTitle, display: item.name, sub: "" };
}

// Bogstavet en række hører under (æ, ø og å for sig, alt andet under #)
function letterOf(text) {
    const letter = text.trim().charAt(0).toLocaleUpperCase("da");
    return /^[A-ZÆØÅ]$/.test(letter) ? letter : "#";
}

const ORDER = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ", "#"];

// Elever og lærere har en profil (med skema-knap); klasser, hold og lokaler går direkte til skemaet
function linkFor(item) {
    return /^[ST]\d+$/.test(item.id) ? `/person/?id=${encodeURIComponent(item.id)}` : `/skema/?id=${encodeURIComponent(item.id)}`;
}

function renderKinds() {
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);

    kinds.innerHTML = ["Alle", ...groups.map(group => group.title)].map(title => {
        const count = title === "Alle" ? total : groups.find(group => group.title === title).items.length;
        return `<md-filter-chip label="${escapeHtml(title)} (${count})" data-kind="${escapeHtml(title)}"${title === kind ? " selected" : ""}></md-filter-chip>`;
    }).join("");
}

function rowHtml(item) {
    return `
        <md-list-item type="link" href="${linkFor(item)}">
            <md-icon slot="start">${ICONS[item.id[0]] ?? "person"}</md-icon>
            <div slot="headline">${escapeHtml(item.display)}</div>
            ${item.sub || kind === "Alle" ? `<div slot="supporting-text">${escapeHtml([item.sub, kind === "Alle" ? item.group : ""].filter(Boolean).join(" · "))}</div>` : ""}
            <md-icon slot="end">chevron_right</md-icon>
        </md-list-item>`;
}

// Tegner de næste sektioner (ca. CHUNK rækker)
function drawMore() {
    let rows = 0;
    let html = "";

    while (drawn < sections.length && rows < CHUNK) {
        const { letter, items } = sections[drawn];
        html += `<section class="letter-group" id="letter-${encodeURIComponent(letter)}">
            <h2 class="letter">${escapeHtml(letter)}</h2>
            <md-list class="results">${items.map(rowHtml).join("")}</md-list>
        </section>`;
        rows += items.length;
        drawn++;
    }

    results.insertAdjacentHTML("beforeend", html);
    sentinel.hidden = drawn >= sections.length;
}

// Tegner indtil et bogstav findes, og ruller derhen
function jumpTo(letter) {
    while (drawn < sections.length && !document.getElementById(`letter-${encodeURIComponent(letter)}`)) drawMore();
    document.getElementById(`letter-${encodeURIComponent(letter)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function render() {
    const query = normalize(searchField.value.trim());

    const pool = groups
        .filter(group => kind === "Alle" || group.title === kind)
        .flatMap(group => group.items.map(item => describe(item, group.title)))
        .filter(item => !query || normalize(item.name).includes(query))
        .sort((a, b) => a.display.localeCompare(b.display, "da"));

    const byLetter = new Map();
    for (const item of pool) {
        const letter = letterOf(item.display);
        if (!byLetter.has(letter)) byLetter.set(letter, []);
        byLetter.get(letter).push(item);
    }

    sections = ORDER.filter(letter => byLetter.has(letter)).map(letter => ({ letter, items: byLetter.get(letter) }));

    results.innerHTML = "";
    drawn = 0;
    drawMore();

    alphabet.innerHTML = sections.map(({ letter }) => `<button type="button" data-letter="${escapeHtml(letter)}">${escapeHtml(letter)}</button>`).join("");
    alphabet.hidden = sections.length === 0;

    document.querySelector("#count").textContent = `${pool.length} ${pool.length === 1 ? "resultat" : "resultater"}`;
    showEmpty(pool.length ? "" : "Ingen fundet.");
}

kinds.addEventListener("click", event => {
    const chip = event.target.closest("[data-kind]");
    if (!chip) return;

    kind = chip.dataset.kind;
    renderKinds();
    render();
});

alphabet.addEventListener("click", event => {
    const button = event.target.closest("[data-letter]");
    if (button) jumpTo(button.dataset.letter);
});

let timer;
searchField.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
});

// Rulles der mod bunden, tegnes næste bid
new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) drawMore();
}, { rootMargin: "600px" }).observe(sentinel);

// ?type=elever / laerere vælger kategorien på forhånd (fra forsiden)
function presetKind() {
    const wanted = new URLSearchParams(location.search).get("type");
    if (!wanted) return;

    const found = groups.find(group => normalize(group.title).replace("æ", "ae").startsWith(wanted.slice(0, 5)));
    if (found) kind = found.title;
}

async function load() {
    try {
        ({ groups } = await apiGet("/api/find"));
        presetKind();
        renderKinds();
        render();
    } catch (error) {
        showEmpty(error.message);
    }
}

load();
