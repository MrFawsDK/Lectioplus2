// Fraværssiden bygger på Lectios fraværsside: opgjort fravær, hele året, fravær pr. hold
// og de moduler hvor man har haft fravær (med eller uden årsag).


// Farver til cirkeldiagrammet (et hold pr. farve)
const teamColor = name => `hsl(${subjectHue(name)} 65% 50%)`;

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const number = text => {
    const match = String(text ?? "").replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(",", ".")) : 0;
};

const format = value => `${value.toFixed(1).replace(".", ",")} %`;
const isTotal = team => /^(samlet|i alt)/i.test(team.name);

function modulesText(count) {
    return `${count} modul${count === 1 ? "" : "er"}`;
}

function when(module) {
    const date = module.date ? module.date.split("-").reverse().join("/") : "";
    return [module.week, date, module.start && `${module.start}–${module.end}`].filter(Boolean).join(" · ");
}


/* ---------- Opgjort og hele året ---------- */

function renderTotals(total) {
    const period = number(total.period.pct);
    const year = number(total.year.pct);

    document.querySelector("#periodPct").textContent = format(period);
    document.querySelector("#periodModules").textContent = modulesText(number(total.period.modules));
    document.querySelector("#yearPct").textContent = format(year);
    document.querySelector("#yearModules").textContent = modulesText(number(total.year.modules));
}

/* ---------- Cirkeldiagram og tabel pr. hold ---------- */

function renderTeams(teams) {
    const sorted = teams
        .map(team => ({ ...team, count: number(team.year.modules), pct: number(team.year.pct) }))
        .sort((a, b) => b.count - a.count);

    const sum = sorted.reduce((total, team) => total + team.count, 0);
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    document.querySelector("#donut").innerHTML = sum === 0
        ? `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--md-sys-color-surface-container-high)" stroke-width="14"></circle>`
        : sorted.filter(team => team.count > 0).map((team, index) => {
            const length = circumference * team.count / sum;
            const slice = `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${teamColor(team.name)}" stroke-width="14"
                stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escapeHtml(team.name)}: ${team.count}</title></circle>`;
            offset += length;
            return slice;
        }).join("");

    document.querySelector("#donutTotal").textContent = sum;

    const max = sorted[0]?.count || 1;
    document.querySelector("#teamBody").innerHTML = sorted.map((team, index) => `
        <tr>
            <th scope="row"><i class="dot" style="background:${teamColor(team.name)}"></i>${escapeHtml(team.name)}</th>
            <td>${escapeHtml(team.year.pct)}</td>
            <td><div class="mini-bar"><div style="width:${team.count / max * 100}%"></div></div></td>
            <td class="right">${modulesText(team.count)}</td>
        </tr>`).join("");
}


/* ---------- Meddelelser og moduler med fravær ---------- */

// Knap til Lectios egen side, hvor man angiver eller retter årsagen (åbner i en ny fane)
// M3: Buttons - Text button: https://m3.material.io/components/buttons/overview
function reasonButton(module, label) {
    return module.reasonUrl
        ? `<md-text-button href="${escapeHtml(module.reasonUrl)}" target="_blank" rel="noopener">${label}</md-text-button>`
        : "";
}

function renderWarnings(warnings) {
    document.querySelector("#warningTitle").textContent = `Meddelelser og bemærkninger: ${warnings.length}`;
    document.querySelector("#warningGroup").hidden = warnings.length === 0;
    document.querySelector("#warningBody").innerHTML = warnings.map(item => `
        <tr>
            <th scope="row">${escapeHtml(item.date)}</th>
            <td>${escapeHtml(item.initials)}</td>
            <td>${escapeHtml(item.type)}</td>
            <td class="wrap">${escapeHtml(item.note)}</td>
        </tr>`).join("");
}

function renderModules(missing, registered) {
    const row = (module, cells) =>
        `<tr><th scope="row">${escapeHtml(module.subject || module.title || "Modul")}</th><td>${escapeHtml(when(module))}</td>${cells}</tr>`;

    document.querySelector("#missingTitle").textContent = `Manglende fraværsårsager: ${missing.length}`;
    document.querySelector("#missingGroup").hidden = missing.length === 0;
    document.querySelector("#missingBody").innerHTML = missing.map(module =>
        row(module, `<td>${escapeHtml(module.absence)}</td><td>${escapeHtml(module.type)}</td>
            <td class="wrap">${escapeHtml(module.comment)}</td><td>${reasonButton(module, "Angiv årsag")}</td>`)).join("");

    document.querySelector("#registeredTitle").textContent = `Fraværsårsager angivet: ${registered.length}`;
    document.querySelector("#registeredGroup").hidden = registered.length === 0;
    document.querySelector("#registeredBody").innerHTML = registered.map(module =>
        row(module, `<td>${escapeHtml(module.absence)}</td><td>${escapeHtml(module.reason)}</td><td class="wrap">${escapeHtml(module.reasonNote)}</td>
            <td class="wrap">${escapeHtml(module.comment)}</td><td>${reasonButton(module, "Ret")}</td>`)).join("");
}


/* ---------- Start ---------- */

function render({ teams, warnings = [], missing = [], registered = [] }) {
    const total = teams.find(isTotal) ?? teams[0];
    const subjects = teams.filter(team => !isTotal(team));

    renderTotals(total);
    renderTeams(subjects);
    renderWarnings(warnings);
    renderModules(missing, registered);

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
