// Fraværssiden: cirkeldiagram, søjler pr. hold og en diagnose.
// Lectios tabel kender vi ikke på forhånd, så tallene findes ud fra kolonnenavnene.

const WARN = 5;      // % - fra her er fraværet noget man bør holde øje med
const HIGH = 10;     // % - fra her er det højt
const CRITICAL = 20; // % - fra her er det kritisk
const BAR_MAX = 30;  // % - søjlernes fulde bredde

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const number = text => {
    const match = String(text ?? "").replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(",", ".")) : null;
};

const format = value => `${value.toFixed(1).replace(".", ",")} %`;
const isTotal = row => /^(i alt|samlet)/i.test(row.name);

function level(pct) {
    if (pct >= CRITICAL) return { name: "Kritisk", color: "var(--bad)" };
    if (pct >= HIGH) return { name: "Højt", color: "var(--bad)" };
    if (pct >= WARN) return { name: "Moderat", color: "var(--warn)" };
    return { name: "Lavt", color: "var(--ok)" };
}

// Finder tal pr. hold: procent og (hvis kolonnerne findes) fraværsmoduler og moduler i alt
function readRows({ columns, rows }) {
    const find = pattern => columns.findIndex(column => pattern.test(column));
    const pctIndex = columns.findLastIndex(column => /%/.test(column));
    const absentIndex = find(/fravær.*modul|modul.*fravær|antal/i);
    const totalIndex = find(/i alt|modul.*alt|planlagt/i);

    return rows.map(row => {
        const percentCell = pctIndex >= 0 ? row.cells[pctIndex] : row.cells.findLast(cell => /%/.test(cell));
        return {
            name: row.name,
            total: isTotal(row),
            pct: number(percentCell),
            absent: absentIndex >= 0 ? number(row.cells[absentIndex]) : null,
            modules: totalIndex >= 0 ? number(row.cells[totalIndex]) : null
        };
    }).filter(row => row.pct !== null);
}

function renderDonut(pct) {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const arc = circumference * Math.min(pct, 100) / 100;

    document.querySelector("#donut").innerHTML = `
        <circle class="track" cx="60" cy="60" r="${radius}"></circle>
        <circle class="slice" cx="60" cy="60" r="${radius}" stroke="var(--bad)"
            stroke-dasharray="${arc} ${circumference}"></circle>`;

    document.querySelector("#totalPct").textContent = format(pct);
    document.querySelector("#absentPct").textContent = format(pct);
    document.querySelector("#presentPct").textContent = format(100 - pct);
}

function renderBars(teams) {
    document.querySelector("#bars").innerHTML = [...teams].sort((a, b) => b.pct - a.pct).map(team => `
        <div class="bar-row">
            <span class="bar-label" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${Math.min(team.pct / BAR_MAX, 1) * 100}%;background:${level(team.pct).color}"></div>
            </div>
            <span class="bar-value">${format(team.pct)}</span>
        </div>`).join("");
}

function renderDiagnosis(total, teams) {
    const { name, color } = level(total);
    const worst = [...teams].sort((a, b) => b.pct - a.pct)[0];
    const high = teams.filter(team => team.pct >= HIGH);
    const clean = teams.filter(team => team.pct === 0);
    const insights = [];

    if (total < WARN) insights.push("Dit samlede fravær er lavt. Fortsæt som du gør.");
    if (total >= WARN && total < HIGH) insights.push(`Du er under ${HIGH} %, men tæt nok på til, at du bør holde øje med det.`);
    if (total >= HIGH) insights.push(`Du er over ${HIGH} %. Tal med dine lærere eller din studievejleder, hvis fraværet skyldes noget bestemt.`);

    if (worst && worst.pct >= WARN) insights.push(`Mest fravær har du i ${worst.name} (${format(worst.pct)}).`);
    if (high.length > 1) insights.push(`${high.length} hold ligger over ${HIGH} %: ${high.map(team => team.name).join(", ")}.`);
    if (clean.length) insights.push(`Du har intet fravær i ${clean.map(team => team.name).join(", ")}.`);

    document.querySelector("#verdict").innerHTML =
        `<span class="badge" style="background:${color}">${name}</span><span>${format(total)} fravær</span>`;
    document.querySelector("#insights").innerHTML = insights.map(text => `<li>${escapeHtml(text)}</li>`).join("");
}

function renderTable({ columns, rows }) {
    document.querySelector("#absenceHead").innerHTML =
        `<th scope="col">Hold</th>` + columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join("");

    document.querySelector("#absenceBody").innerHTML = rows.map(row =>
        `<tr${isTotal(row) ? ` class="total"` : ""}><th scope="row">${escapeHtml(row.name)}</th>` +
        row.cells.map(cell => `<td>${escapeHtml(cell || "–")}</td>`).join("") + `</tr>`
    ).join("");
}

// Kurve over fravær pr. uge: bruger den sidste kolonne med procent, hvis Lectio giver ugetal
function renderWeeks({ weeks = [], weekColumns = [] }) {
    const index = weekColumns.findLastIndex(column => /%/.test(column));
    const points = weeks
        .map(item => ({ week: item.week, pct: number(index >= 0 ? item.cells[index] : item.cells.findLast(cell => /%/.test(cell))) }))
        .filter(point => point.pct !== null)
        .sort((a, b) => a.week - b.week);

    if (points.length < 2) return;

    const W = 600, H = 220, left = 36, right = 12, top = 12, bottom = 28;
    const max = Math.max(HIGH * 1.5, ...points.map(point => point.pct));
    const x = i => left + (W - left - right) * i / (points.length - 1);
    const y = pct => top + (H - top - bottom) * (1 - pct / max);

    const grid = [0, max / 2, max].map(value =>
        `<line class="grid-line" x1="${left}" x2="${W - right}" y1="${y(value)}" y2="${y(value)}"></line>
         <text x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${Math.round(value)} %</text>`).join("");

    const labels = points.map((point, i) => i % Math.ceil(points.length / 12) === 0
        ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${point.week}</text>` : "").join("");

    document.querySelector("#weekChart").innerHTML = grid +
        `<line class="grid-line ten" x1="${left}" x2="${W - right}" y1="${y(HIGH)}" y2="${y(HIGH)}"></line>` +
        `<polyline class="path" points="${points.map((point, i) => `${x(i)},${y(point.pct)}`).join(" ")}"></polyline>` +
        points.map((point, i) => `<circle class="point" cx="${x(i)}" cy="${y(point.pct)}" r="3"><title>Uge ${point.week}: ${format(point.pct)}</title></circle>`).join("") +
        labels;

    document.querySelector("#weekCard").hidden = false;
}

function render(data) {
    const all = readRows(data);
    const teams = all.filter(row => !row.total);
    const overall = all.find(row => row.total);

    if (!all.length) throw new Error("Kunne ikke læse holdtabellen fra Lectio. Åbn /api/fravaer?debug=1 og send resultatet.");

    // Uden "I alt"-række bruges gennemsnittet af holdene
    const total = overall?.pct ?? teams.reduce((sum, team) => sum + team.pct, 0) / teams.length;

    renderDonut(total);
    renderDiagnosis(total, teams.length ? teams : all);
    renderBars(teams.length ? teams : all);
    renderWeeks(data);
    renderTable(data);

    document.querySelector("#emptyState").hidden = true;
    document.querySelector("#content").hidden = false;
}

async function loadAbsence() {
    try {
        render(await apiGet("/api/fravaer"));
    } catch (error) {
        document.querySelector("#emptyText").textContent = error.message;
    }
}

loadAbsence();
