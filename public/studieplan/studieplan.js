// Studieplan: vælg et fag og se dets forløb (titel, periode, estimat og beskrivelse)

const subjectBar = document.querySelector("#subjects");
const phasesBox = document.querySelector("#phases");
const emptyState = document.querySelector("#emptyState");

let subjects = [];
let selected = 0;

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderSubjects() {
    // Det valgte fag er en tonal knap, de andre er tekstknapper (M3: Buttons)
    subjectBar.innerHTML = subjects.map((item, index) => {
        const tag = index === selected ? "md-filled-tonal-button" : "md-text-button";
        return `<${tag} data-index="${index}">${escapeHtml(item.subject)}</${tag}>`;
    }).join("");
}

function renderPhases() {
    const { phases = [] } = subjects[selected] ?? {};

    phasesBox.innerHTML = phases.map(phase => `
        <article class="phase">
            <div class="phase-head">
                <strong>${escapeHtml(phase.title)}</strong>
                <span>${escapeHtml([phase.period, phase.estimate].filter(Boolean).join(" · "))}</span>
            </div>
            ${phase.description ? `<p>${escapeHtml(phase.description)}</p>` : ""}
        </article>`).join("");

    emptyState.hidden = phases.length > 0;
    document.querySelector("#emptyText").textContent = "Der er ingen forløb i dette fag.";
}

subjectBar.addEventListener("click", event => {
    const button = event.target.closest("[data-index]");
    if (!button) return;

    selected = Number(button.dataset.index);
    renderSubjects();
    renderPhases();
});

async function loadStudyPlan() {
    try {
        ({ subjects } = await apiGet("/api/studieplan"));
        renderSubjects();
        renderPhases();

        if (!subjects.length) document.querySelector("#emptyText").textContent = "Fandt ingen fag i studieplanen.";
    } catch (error) {
        emptyState.hidden = false;
        document.querySelector("#emptyText").textContent = error.message;
    }
}

loadStudyPlan();
