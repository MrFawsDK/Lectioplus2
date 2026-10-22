// Login: vælg skole, indsæt Lectio-cookie, og serveren tjekker den hos lectio.dk.

const SCHOOL_KEY = "flexio.skole"; // kun skolens kode og navn, aldrig cookien
const OLD_SCHOOL_KEY = "lectioplus.skole"; // fra før navneskiftet
const MAX_RESULTS = 6;

const schoolField = document.querySelector("#schoolField");
const schoolResults = document.querySelector("#schoolResults");
const openLectioButton = document.querySelector("#openLectioButton");
const cookieField = document.querySelector("#cookieField");
const loginButton = document.querySelector("#loginButton");
const message = document.querySelector("#loginMessage");
const workingText = document.querySelector("#workingText");

let schools = [];
let selectedSchool = null;


/* ---------- Hjælpere ---------- */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Kun adresser på vores egen side (ikke "//andet-site.dk")
function nextUrl() {
    const next = new URLSearchParams(location.search).get("next") ?? "";
    return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/skema/";
}

function showMessage(text, type = "error") {
    message.textContent = text;
    message.className = `login-message ${type}`;
    message.hidden = !text;
}

function setWorking(working) {
    loginButton.disabled = working;
    workingText.hidden = !working;
}

function readStoredSchool() {
    try {
        return JSON.parse(localStorage.getItem(SCHOOL_KEY) ?? localStorage.getItem(OLD_SCHOOL_KEY));
    } catch {
        return null;
    }
}

function storeSchool(school) {
    try {
        localStorage.setItem(SCHOOL_KEY, JSON.stringify(school));
    } catch {
        // Ikke vigtigt hvis det ikke kan gemmes
    }
}


/* ---------- Skole ---------- */

function selectSchool(school) {
    selectedSchool = school;
    schoolField.value = school.name;
    schoolField.error = false;
    schoolResults.hidden = true;

    openLectioButton.disabled = false;
    openLectioButton.href = `https://www.lectio.dk/lectio/${encodeURIComponent(school.schoolCode)}/forside.aspx`;

    storeSchool(school);
}

// M3: Lists - List item (type="button")
// Guide: https://m3.material.io/components/lists/overview
// Element: <md-list-item> fra @material/web/list/list-item.js
function renderSchoolResults() {
    const query = schoolField.value.trim().toLowerCase();

    if (!query || (selectedSchool && schoolField.value === selectedSchool.name)) {
        schoolResults.hidden = true;
        return;
    }

    const matches = schools
        .filter(school => school.name.toLowerCase().includes(query) || school.schoolCode === query)
        .slice(0, MAX_RESULTS);

    schoolResults.innerHTML = matches.length
        ? matches.map(school => `
            <md-list-item type="button" data-code="${escapeHtml(school.schoolCode)}">
                <md-icon slot="start">school</md-icon>
                <div slot="headline">${escapeHtml(school.name)}</div>
            </md-list-item>
        `).join("")
        : `<md-list-item><div slot="headline">Ingen skoler fundet</div></md-list-item>`;

    schoolResults.hidden = false;
}

schoolField.addEventListener("input", () => {
    selectedSchool = null;
    openLectioButton.disabled = true;
    renderSchoolResults();
});

schoolResults.addEventListener("click", event => {
    const item = event.target.closest("[data-code]");
    if (!item) return;

    const school = schools.find(entry => entry.schoolCode === item.dataset.code);
    if (school) selectSchool(school);
});

async function loadSchools() {
    try {
        schools = (await apiGet("/api/schools")).schools ?? [];
    } catch (error) {
        showMessage("Kunne ikke hente listen over skoler fra Lectio. Prøv igen om lidt.");
        console.error(error);
    }

    const stored = readStoredSchool();
    const school = stored && schools.find(entry => entry.schoolCode === stored.schoolCode);
    if (school) selectSchool(school);
}


/* ---------- Log ind ---------- */

async function login(event) {
    event?.preventDefault();
    showMessage("");

    if (!selectedSchool) {
        schoolField.error = true;
        schoolField.errorText = "Vælg din skole på listen";
        schoolField.focus();
        return;
    }

    const cookie = cookieField.value.trim();
    if (!cookie) {
        cookieField.error = true;
        cookieField.errorText = "Indsæt din Lectio-cookie";
        cookieField.focus();
        return;
    }

    setWorking(true);

    try {
        await apiPost("/api/login", { schoolCode: selectedSchool.schoolCode, cookie });
        cookieField.value = "";
        location.href = nextUrl();
    } catch (error) {
        showMessage(error.message);
        setWorking(false);
    }
}

document.querySelector("#loginForm").addEventListener("submit", login);
loginButton.addEventListener("click", login);

cookieField.addEventListener("input", () => {
    cookieField.error = false;
});

document.querySelector("#demoButton").addEventListener("click", async () => {
    try {
        await apiPost("/api/login", { demo: true });
        location.href = nextUrl();
    } catch (error) {
        showMessage(error.message);
    }
});


/* ---------- Start ---------- */

async function start() {
    const reason = new URLSearchParams(location.search).get("grund");
    if (reason === "udlobet") {
        showMessage("Din Lectio-session er udløbet. Hent en ny cookie fra Lectio og log ind igen.", "info");
    }

    // Allerede logget ind? Så videre.
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (response.ok) {
        location.href = nextUrl();
        return;
    }

    await customElements.whenDefined("md-outlined-text-field");
    loadSchools();
}

start();
