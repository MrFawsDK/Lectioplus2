// En note som en anden elev har delt med eleven eller elevens hold (se api/noter.js). Adressen er
//   /delt/#intern/<id>    kræver login
// Siden bruger ikke session.js - den viser selv en log ind-knap og sender tilbage hertil bagefter.

const hash = decodeURIComponent(location.hash.slice(1));
const internalId = hash.startsWith("intern/") ? hash.slice("intern/".length) : null;
const noteUrl = `/api/delt-med-mig/${encodeURIComponent(internalId ?? "")}`;

const statusText = document.querySelector("#status");
const copyButton = document.querySelector("#copyButton");
const loginButton = document.querySelector("#loginButton");
const loginText = document.querySelector("#loginText");

function longDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// "delt af Anna", og for noter delt i Flexio også med hvem: "delt af Anna med 2y Fy"
function sharedText(data) {
    if (!data.sharedBy) return "";
    if (!data.via) return `delt af ${data.sharedBy}`;
    return `delt af ${data.sharedBy} med ${data.via}`;
}

function showError(text) {
    statusText.textContent = text;
    statusText.hidden = false;
    document.querySelector("#note").hidden = true;
}

async function loadNote() {
    if (!internalId) return showError("Noten findes ikke. Noter deles nu direkte med brugere - find dem under \"Delt med dig\" i Noter.");

    const response = await fetch(noteUrl, { credentials: "same-origin" });
    const data = await response.json().catch(() => null);

    if (response.status === 401) {
        loginText.textContent = "Log ind";
        loginButton.hidden = false;
        return showError("Log ind for at se noten.");
    }
    if (!response.ok) return showError(data?.error ?? "Kunne ikke hente noten.");

    const title = data.title || "Uden titel";
    document.title = `${title} - Flexio`;
    document.querySelector("#title").textContent = title;
    document.querySelector("#meta").textContent = [data.subject, longDate(data.date), sharedText(data)]
        .filter(Boolean)
        .join(" · ");
    document.querySelector("#content").innerHTML = sanitizeHtml(data.content) || "<p></p>";

    statusText.hidden = true;
    document.querySelector("#note").hidden = false;

    // Logget ind? Så kan noten gemmes som kopi
    const me = await fetch("/api/me", { credentials: "same-origin" });
    copyButton.hidden = !me.ok;
    loginButton.hidden = me.ok;
}

copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;

    const response = await fetch(`${noteUrl}/kopi`, { method: "POST", credentials: "same-origin" });
    const data = await response.json().catch(() => null);

    if (response.ok) {
        location.href = `/noter/#note/${encodeURIComponent(data.id)}`;
    } else if (response.status === 401) {
        loginButton.click();
    } else {
        copyButton.disabled = false;
        statusText.textContent = data?.error ?? "Kunne ikke gemme kopien.";
        statusText.hidden = false;
    }
});

loginButton.addEventListener("click", () => {
    const next = location.pathname + location.hash;
    location.href = `/login/?${new URLSearchParams({ next })}`;
});

loadNote().catch(error => {
    console.error(error);
    showError("Kunne ikke hente noten.");
});
