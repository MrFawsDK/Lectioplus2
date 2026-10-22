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

// POST / PUT / DELETE med JSON
async function apiSend(method, url, body = {}) {
    const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
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
