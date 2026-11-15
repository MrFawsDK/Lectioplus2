// Fælles for alle sider: kald til vores API og login-tjek.
// Selve Lectio-cookien ligger kun på serveren - browseren har kun en sessions-cookie (httpOnly).

const LOGIN_PAGE = "/login/";

function goToLogin(reason) {
    const next = location.pathname + location.search + location.hash;
    const params = new URLSearchParams({ next });
    if (reason) params.set("grund", reason);
    location.href = `${LOGIN_PAGE}?${params}`;
}

// Henter JSON fra vores API. Ved 401 sendes brugeren til login.
async function apiGet(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (response.status === 401) {
        goToLogin(data?.code === "not_authenticated" ? "udlobet" : "");
        // Stop koden der kaldte, mens siden skifter
        return new Promise(() => {});
    }

    if (!response.ok) {
        throw new Error(data?.error ?? `Fejl ${response.status}`);
    }

    return data;
}

async function apiPost(url, body = {}) {
    return apiSend("POST", url, body);
}

// POST / PUT / DELETE med JSON.
// keepalive: true lader kaldet gøre sig færdigt, selvom siden lukkes (kun til små kald, max 64 KB)
async function apiSend(method, url, body = {}, { keepalive = false } = {}) {
    const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    // Udløbet session (men ikke på login-siden, hvor 401 betyder forkert cookie)
    if (response.status === 401 && !location.pathname.startsWith(LOGIN_PAGE)) {
        goToLogin(data?.code === "not_authenticated" ? "udlobet" : "");
        return new Promise(() => {});
    }

    if (!response.ok) {
        const error = new Error(data?.error ?? `Fejl ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
}

// Hvem er logget ind? Hentes én gang pr. side.
let mePromise = null;

function getMe() {
    mePromise ??= apiGet("/api/me");
    return mePromise;
}

async function logout() {
    try {
        await apiPost("/api/logout");
    } finally {
        location.href = LOGIN_PAGE;
    }
}

// Alle sider undtagen login kræver at man er logget ind
if (!location.pathname.startsWith(LOGIN_PAGE)) {
    getMe();
}


/* ---------- Flexios indstillinger ----------
   Gemmes pr. elev på serveren (se api/indstillinger.js). En kopi ligger i localStorage, så temaet kan sættes med det
   samme, før svaret fra serveren er kommet. Alle sider læser dem via getSettings(). */

const SETTINGS_KEY = "flexio.indstillinger";
const TEXT_ZOOM = { small: 0.9, normal: 1, large: 1.15 };
const DEFAULT_SETTINGS = { theme: "system", accent: "blue", textSize: "normal", startPage: "/forside/", hiddenMenu: [], noteFont: "Roboto", noteSubject: "", subjectColors: true };

function cachedSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function cacheSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Ikke vigtigt hvis det ikke kan gemmes
    }
}

// Sætter tema, farve og tekststørrelse på siden
function applySettings(settings) {
    const root = document.documentElement;
    const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.accent = settings.accent;
    root.style.setProperty("--flexio-zoom", TEXT_ZOOM[settings.textSize] ?? 1);
}

let settingsPromise = null;
let currentSettings = cachedSettings();

// Elevens indstillinger fra serveren (hentes én gang pr. side)
function getSettings() {
    settingsPromise ??= apiGet("/api/indstillinger").then(data => {
        currentSettings = data.settings;
        cacheSettings(currentSettings);
        applySettings(currentSettings);
        return currentSettings;
    });
    return settingsPromise;
}

// Gemmer en eller flere indstillinger og bruger dem med det samme
async function saveSettings(patch) {
    currentSettings = { ...currentSettings, ...patch };
    cacheSettings(currentSettings);
    applySettings(currentSettings);

    const data = await apiSend("PUT", "/api/indstillinger", patch);
    currentSettings = data.settings;
    cacheSettings(currentSettings);
    applySettings(currentSettings);
    return currentSettings;
}

async function resetSettings() {
    const data = await apiSend("DELETE", "/api/indstillinger");
    currentSettings = data.settings;
    cacheSettings(currentSettings);
    applySettings(currentSettings);
    return currentSettings;
}

// Siden man starter på efter login (sidste kendte valg, ellers forsiden)
function startPage() {
    return cachedSettings().startPage;
}

applySettings(currentSettings);

// "Følg systemet": skift med, når telefonen/computeren skifter mellem lyst og mørkt
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applySettings(currentSettings));

if (!location.pathname.startsWith(LOGIN_PAGE)) {
    getSettings().catch(() => {});
}


/* ---------- Fagfarver ----------
   Hvert fag får sin egen farvetone, så fagene er nemme at kende fra hinanden på tværs af siderne.
   subjectStyle("2y Ma") giver fx "--fag-h:215", som CSS'en i style.css laver om til baggrund, tekst og kantfarve.
   Kan slås fra i Indstillinger (subjectColors). */

// Kendte fag får en fast tone (stems = begyndelsen af ordet, codes = Lectios forkortelser). Andre fag får en tone ud fra navnet.
const SUBJECT_HUES = [
    { hue: 215, stems: ["matem"], codes: ["ma", "mat"] },
    { hue: 0, stems: ["dansk"], codes: ["da", "dan"] },
    { hue: 280, stems: ["engel"], codes: ["en", "eng"] },
    { hue: 175, stems: ["fysik"], codes: ["fy", "fys"] },
    { hue: 150, stems: ["inform"], codes: ["inf", "infb", "infa", "infc"] },
    { hue: 35, stems: ["histor"], codes: ["hi", "his"] },
    { hue: 95, stems: ["idræt", "idraet"], codes: ["id", "idr"] },
    { hue: 195, stems: ["teknol"], codes: ["tek", "tec"] },
    { hue: 320, stems: ["kemi"], codes: ["ke", "kem"] },
    { hue: 120, stems: ["biolog"], codes: ["bi", "bio"] },
    { hue: 50, stems: ["samfund"], codes: ["sa", "sam"] },
    { hue: 245, stems: ["studietid", "studie"], codes: ["st"] },
    { hue: 265, stems: ["klassetime", "klasse"], codes: ["kl"] },
    { hue: 15, stems: ["tysk"], codes: ["ty"] },
    { hue: 335, stems: ["fransk"], codes: ["fr"] },
    { hue: 70, stems: ["religion"], codes: ["re"] },
    { hue: 20, stems: ["design"], codes: ["de"] }
];

function subjectHue(name) {
    // "2y 25htx InfB" -> ["infb"]: klasse-koderne (2y, 25htx ...) er ikke en del af faget
    const words = String(name ?? "").toLowerCase().split(/[\s,/]+/).filter(word => word && !/^\d+[a-zæøå]*$/.test(word));

    for (const word of words) {
        const known = SUBJECT_HUES.find(item => item.codes.includes(word) || item.stems.some(stem => word.startsWith(stem)));
        if (known) return known.hue;
    }

    // Ukendt fag: samme navn giver altid samme tone
    let hash = 0;
    for (const char of words.join(" ") || String(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 360;
}

// Til style-attributten på et element. Tom, hvis fagfarver er slået fra (eller faget mangler).
function subjectStyle(name) {
    if (!name || cachedSettings().subjectColors === false) return "";
    return `--fag-h:${subjectHue(name)}`;
}
