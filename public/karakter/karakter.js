// Karakterbladet hentes fra vores server, som henter det fra Lectio
const DATA_URL = "/api/karakterer";

// Karakterer på 7-trinsskalaen, som tæller med i gennemsnittet
const NUMERIC = ["-3", "00", "02", "4", "7", "10", "12"];

const lead = document.querySelector("#lead");
const table = document.querySelector("#gradeTable");
const emptyState = document.querySelector("#emptyState");


/* ---------- Hjælpere ---------- */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatNumber(value) {
    return value.toFixed(1).replace(".", ",");
}

// Karakteren er sløret, indtil man holder musen over den (se karakter.css)
function gradeCell(grade) {
    if (!grade) return `<td class="no-grade">–</td>`;

    const low = grade === "-3" || grade === "00";
    return `<td><span class="grade-value${low ? " low" : ""}" tabindex="0">${escapeHtml(grade)}</span></td>`;
}

// Fagets nyeste karakter er den længst til højre i karakterbladet
function latestNumeric(subject, types) {
    const grades = subject.grades
        .filter(item => NUMERIC.includes(item.grade))
        .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));

    return grades.length ? Number(grades.at(-1).grade) : null;
}


/* ---------- Visning ---------- */

function renderGrades({ types, subjects }) {
    // Kun de karaktertyper der faktisk er givet karakterer i
    const usedTypes = types.filter(type => subjects.some(subject => subject.grades.some(item => item.type === type)));
    const graded = subjects.filter(subject => subject.grades.length);

    document.querySelector("#gradeHead").innerHTML =
        `<th scope="col">Fag</th>` + usedTypes.map(type => `<th scope="col">${escapeHtml(type)}</th>`).join("");

    document.querySelector("#gradeBody").innerHTML = graded.map(subject => {
        const team = subject.team && subject.team !== subject.subject
            ? `<span class="team">${escapeHtml(subject.team)}</span>`
            : "";

        const cells = usedTypes.map(type => gradeCell(subject.grades.find(item => item.type === type)?.grade));

        return `<tr><th scope="row"><span class="subject">${escapeHtml(subject.subject)}</span>${team}</th>${cells.join("")}</tr>`;
    }).join("");

    // Gennemsnit af hvert fags nyeste karakter
    const latest = graded.map(subject => latestNumeric(subject, types)).filter(grade => grade !== null);
    const average = latest.length ? latest.reduce((sum, grade) => sum + grade, 0) / latest.length : null;

    document.querySelector("#statAverage").textContent = average === null ? "-" : formatNumber(average);
    document.querySelector("#statSubjects").textContent = graded.length;
    document.querySelector("#statGrades").textContent = graded.reduce((sum, subject) => sum + subject.grades.length, 0);

    table.hidden = !graded.length;
    emptyState.hidden = Boolean(graded.length);
    document.querySelector("#emptyText").textContent = "Du har ingen karakterer endnu.";

    lead.textContent = matchMedia("(hover: hover)").matches
        ? "Hold musen over en karakter for at se den. Gennemsnittet er af hvert fags nyeste karakter."
        : "Tryk på en karakter for at se den. Gennemsnittet er af hvert fags nyeste karakter.";
}

// På touch-skærme findes der ingen mus - der viser et tryk karakteren i stedet
document.addEventListener("click", event => {
    const grade = event.target.closest(".grade-value");
    document.querySelectorAll(".grade-value.shown").forEach(item => {
        if (item !== grade) item.classList.remove("shown");
    });
    grade?.classList.toggle("shown");
});

async function loadGrades() {
    emptyState.hidden = false;

    try {
        renderGrades(await apiGet(DATA_URL));
    } catch (error) {
        document.querySelector("#emptyText").textContent = error.message;
    }
}

loadGrades();
