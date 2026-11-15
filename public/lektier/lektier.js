// Lektier: samlet pr. dag, med links til materialer

const days = document.querySelector("#days");
const emptyState = document.querySelector("#emptyState");

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function dayTitle(date) {
    if (!date) return "Uden dato";
    return new Date(`${date}T12:00`).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });
}

function render({ homework }) {
    const byDay = Map.groupBy(
        [...homework].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)),
        item => item.date ?? ""
    );

    days.innerHTML = [...byDay].map(([date, lessons]) => `
        <section class="day">
            <h2>${escapeHtml(dayTitle(date))}</h2>
            ${lessons.map(lesson => `
                <article class="lesson">
                    <div class="lesson-head">
                        <strong>${escapeHtml(lesson.subject)}</strong>
                        <span>${escapeHtml([lesson.start && `${lesson.start}–${lesson.end}`, lesson.teacher].filter(Boolean).join(" · "))}</span>
                    </div>
                    ${lesson.title ? `<p class="topic">${escapeHtml(lesson.title)}</p>` : ""}
                    <ul class="items">
                        ${lesson.items.map(item => `<li>${item.href
                            ? `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener">${escapeHtml(item.text)}</a>`
                            : escapeHtml(item.text)}</li>`).join("")}
                    </ul>
                </article>`).join("")}
        </section>`).join("");

    emptyState.hidden = homework.length > 0;
    document.querySelector("#emptyText").textContent = "Du har ingen lektier.";
}

async function loadHomework() {
    try {
        render(await apiGet("/api/lektier"));
    } catch (error) {
        emptyState.hidden = false;
        document.querySelector("#emptyText").textContent = error.message;
    }
}

loadHomework();
