// En anden elevs eller lærers profil: billede, navn, klasse/hold og en knap til deres skema (/person/?id=S123)

const ID = new URLSearchParams(location.search).get("id");

const content = document.querySelector("#content");
const emptyState = document.querySelector("#emptyState");

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function initials(name) {
    const words = String(name ?? "").replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase();
}

// Tilbage: dér hvor man kom fra (fx listen med elever), ellers til Find
document.querySelector("#backButton").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = "/find/";
});

function loadPhoto(person) {
    if (!person.hasPhoto) return;

    const image = document.querySelector("#avatarImage");
    image.addEventListener("load", () => {
        image.hidden = false;
        document.querySelector("#avatarInitials").hidden = true;
    });
    image.src = `/api/person/${encodeURIComponent(person.id)}/billede`;
}

function render(person) {
    document.title = `${person.name} - Flexio`;
    document.querySelector("#personName").textContent = person.name;
    document.querySelector("#avatarInitials").textContent = initials(person.name);
    document.querySelector("#personSub").textContent = [person.label, person.className].filter(Boolean).join(" · ");

    document.querySelector("#scheduleButton").addEventListener("click", () => {
        location.href = `/skema/?id=${encodeURIComponent(person.id)}`;
    });

    // En lærers hold: et tryk viser holdets skema
    const teams = person.teams ?? [];
    document.querySelector("#teamsCard").hidden = teams.length === 0;
    document.querySelector("#teamsList").innerHTML = teams.map(team => `
        <md-list-item type="link" href="/skema/?id=${encodeURIComponent(team.id)}">
            <md-icon slot="start">diversity_3</md-icon>
            <div slot="headline">${escapeHtml(team.name)}</div>
            <md-icon slot="end">chevron_right</md-icon>
        </md-list-item>`).join("");

    loadPhoto(person);
    emptyState.hidden = true;
    content.hidden = false;
}

async function load() {
    if (!ID || !/^[ST]\d+$/.test(ID)) {
        document.querySelector("#emptyText").textContent = "Vælg en person i Find skema.";
        return;
    }

    try {
        render(await apiGet(`/api/person/${encodeURIComponent(ID)}`));
    } catch (error) {
        document.querySelector("#emptyText").textContent = error.message;
    }
}

load();
