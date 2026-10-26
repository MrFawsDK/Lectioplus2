# m3: Material 3-komponenter

Mappen giver hele siden Googles [Material 3](https://m3.material.io/)-komponenter (knapper, chips, dialoger osv.) fra biblioteket [@material/web](https://github.com/material-components/material-web) v2.5.0.

## Filerne

| Fil | Hvad den gør | Må du redigere den? |
| --- | --- | --- |
| [`komponenter.js`](komponenter.js) | Listen over hvilke komponenter siden bruger. Én `import` pr. komponent. | Ja. Det er kilden. |
| [`m3.css`](m3.css) | Temaet: farver og skrifttyper for alle komponenter. | Ja. |
| [`material.js`](material.js) | Al koden til komponenterne samlet i én fil, som siderne loader. Bygges fra `komponenter.js`. | **Nej.** Det bliver overskrevet næste gang du bygger. |

Bygningen styres af [`scripts/build-m3.js`](../../scripts/build-m3.js).

Alle sider loader de to filer sådan:

```html
<link rel="stylesheet" href="/m3/m3.css">
<script type="module" src="/m3/material.js"></script>
```

## Sådan tilføjer du en ny komponent

1. Find komponenten i [dokumentationen](https://github.com/material-components/material-web/tree/v2.5.0/docs/components).
2. Tilføj dens `import` i [`komponenter.js`](komponenter.js) under den rigtige gruppe, fx `import "@material/web/checkbox/checkbox.js";`
3. Byg bundlet igen:
   ```bash
   npm run build:m3
   ```
4. Brug tagget i din HTML, fx `<md-checkbox></md-checkbox>`, og tilføj den til tabellerne herunder.

Fjerner du en komponent, så slet dens `import` og byg igen.

## Sådan finder du rundt i `material.js`

Filen er ikke minificeret, så den kan læses. Den er delt op i sektioner:

1. **Fundament: Lit og tslib.** Biblioteket som alle komponenterne er bygget på.
2. **Fælles hjælpekode.** Intern kode som flere komponenter deler.
3. **Effekter.** Elevation, fokusring og ripple.
4. **Knapper og FAB**, 5. **Ikonknapper**, 6. **Segmenterede knapper**, 7. **Chips**, 8. **Formularfelter**, 9. **Lister og divider**, 10. **Dialog og kort**, 11. **Ikon**.
12. **Start.** Registrerer alle elementerne.

Øverst i filen er en indholdsfortegnelse med linjenummeret for hver sektion og hvert `<md-...>`-element. Du kan også bruge søgning:
- Søg efter `SEKTION 7` for at hoppe til Chips.
- Søg efter `md-filter-chip` for at finde en bestemt komponent.
- Hver del af koden starter med `// --- <filnavn>`, efterfulgt af et link til den præcise kildefil på GitHub.

Kommer der en ny mappe ind i bundlet, når du tilføjer en komponent, stopper buildet og beder dig om at placere mappen i en sektion i `SECTIONS` i `scripts/build-m3.js`.

## Sådan ændrer du farverne

Alle farver ligger som `--md-sys-color-*`-variabler i [`m3.css`](m3.css). Ændr fx `--md-sys-color-primary` for at give alle fyldte knapper en ny farve. Hvilken variabel styrer hvad: [farve-guiden](https://github.com/material-components/material-web/blob/v2.5.0/docs/theming/color.md). Vil du lave et helt nyt farveskema, kan du bruge [Material Theme Builder](https://material-foundation.github.io/material-theme-builder/).

## Komponenterne

For hver komponent er der tre links:
- **Docs**: hvordan den bruges (attributter, events, eksempler).
- **Kildekode**: den præcise fil i material-web på GitHub (v2.5.0).
- **Brugt i**: første sted i hver fil i dette projekt hvor komponenten bruges. Linjenumrene peger på `main` og kan flytte sig, når filerne ændres.

### Knapper

Almindelige knapper. Vælg variant efter hvor vigtig handlingen er: fyldt > tonal > outlined > tekst.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-filled-button>` | Fyldt knap til sidens vigtigste handling (fx "Log ind"). | [button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/button.md) | [filled-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/button/filled-button.ts) | [login/index.html#L97](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L97)<br>[noter/index.html#L444](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L444) |
| `<md-filled-tonal-button>` | Blødere fyldt knap til sekundære, men stadig vigtige handlinger. | [button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/button.md) | [filled-tonal-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/button/filled-tonal-button.ts) | [header/header.js#L29](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.js#L29)<br>[noter/index.html#L380](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L380)<br>[profil/index.html#L49](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/profil/index.html#L49) |
| `<md-outlined-button>` | Knap med kant til mellemvigtige handlinger. | [button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/button.md) | [outlined-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/button/outlined-button.ts) | [login/index.html#L60](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L60)<br>[noter/index.html#L66](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L66)<br>[skema/index.html#L52](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L52) |
| `<md-text-button>` | Diskret knap uden baggrund, fx "Luk" i dialoger. | [button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/button.md) | [text-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/button/text-button.ts) | [header/header.html#L9](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.html#L9)<br>[header/header.js#L27](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.js#L27)<br>[login/index.html#L131](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L131)<br>[noter/index.html#L142](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L142)<br>[opgaver/index.html#L112](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L112)<br>[skema/index.html#L119](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L119) |

### FAB

Den store, svævende knap til sidens hovedhandling.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-fab>` | Floating action button, fx "Ny note". | [fab.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md) | [fab.ts](https://github.com/material-components/material-web/blob/v2.5.0/fab/fab.ts) | [noter/index.html#L107](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L107) |

### Ikonknapper

Knapper der kun viser et ikon.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-icon-button>` | Ikon uden baggrund, fx luk, slet, menu. | [icon-button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/icon-button.md) | [icon-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/iconbutton/icon-button.ts) | [header/header.html#L25](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.html#L25)<br>[header/header.js#L33](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.js#L33)<br>[noter/index.html#L123](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L123)<br>[noter/noter.js#L839](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L839)<br>[skema/index.html#L39](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L39) |
| `<md-filled-tonal-icon-button>` | Ikon med tonal baggrund, så den skiller sig ud. | [icon-button.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/icon-button.md) | [filled-tonal-icon-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/iconbutton/filled-tonal-icon-button.ts) | [header/header.js#L35](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.js#L35) |

### Segmenterede knapper (labs)

Gruppe af knapper hvor man vælger én (eller flere) muligheder, fx dag/uge.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-outlined-segmented-button-set>` | Beholderen der samler knapperne. | (labs, ingen docs endnu) | [outlined-segmented-button-set.ts](https://github.com/material-components/material-web/blob/v2.5.0/labs/segmentedbuttonset/outlined-segmented-button-set.ts) | [skema/index.html#L60](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L60) |
| `<md-outlined-segmented-button>` | Én knap i sættet. | (labs, ingen docs endnu) | [outlined-segmented-button.ts](https://github.com/material-components/material-web/blob/v2.5.0/labs/segmentedbutton/outlined-segmented-button.ts) | [skema/index.html#L61](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L61) |

### Chips

Små, kompakte elementer til filtre og hurtige handlinger.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-chip-set>` | Beholder der lægger chips på række. | [chip.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/chip.md) | [chip-set.ts](https://github.com/material-components/material-web/blob/v2.5.0/chips/chip-set.ts) | [noter/index.html#L77](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L77)<br>[noter/noter.js#L413](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L413)<br>[opgaver/index.html#L53](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L53)<br>[skema/index.html#L90](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L90) |
| `<md-assist-chip>` | Chip der udfører en handling eller viser info. | [chip.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/chip.md) | [assist-chip.ts](https://github.com/material-components/material-web/blob/v2.5.0/chips/assist-chip.ts) | [noter/noter.js#L319](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L319)<br>[opgaver/opgaver.js#L329](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/opgaver.js#L329)<br>[skema/skema.js#L343](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L343) |
| `<md-filter-chip>` | Chip der kan slås til/fra som filter. | [chip.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/chip.md) | [filter-chip.ts](https://github.com/material-components/material-web/blob/v2.5.0/chips/filter-chip.ts) | [noter/noter.js#L331](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L331)<br>[opgaver/index.html#L61](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L61)<br>[opgaver/opgaver.js#L118](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/opgaver.js#L118) |

### Formularfelter

Indtastning og valg.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-outlined-text-field>` | Tekstfelt med kant. | [text-field.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/text-field.md) | [outlined-text-field.ts](https://github.com/material-components/material-web/blob/v2.5.0/textfield/outlined-text-field.ts) | [login/index.html#L35](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L35)<br>[login/login.js#L197](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/login.js#L197)<br>[noter/index.html#L31](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L31) |
| `<md-outlined-select>` | Dropdown med kant. | [select.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/select.md) | [outlined-select.ts](https://github.com/material-components/material-web/blob/v2.5.0/select/outlined-select.ts) | [noter/index.html#L40](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L40)<br>[noter/noter.js#L1072](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L1072) |
| `<md-select-option>` | Én mulighed i en dropdown. | [select.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/select.md) | [select-option.ts](https://github.com/material-components/material-web/blob/v2.5.0/select/select-option.ts) | [noter/index.html#L41](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L41)<br>[noter/noter.js#L637](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L637) |

### Lister og opdeling

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-list>` | Beholder til listeelementer. | [list.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/list.md) | [list.ts](https://github.com/material-components/material-web/blob/v2.5.0/list/list.ts) | [login/index.html#L44](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L44)<br>[noter/index.html#L370](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L370)<br>[opgaver/index.html#L103](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L103)<br>[opgaver/opgaver.js#L248](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/opgaver.js#L248)<br>[profil/index.html#L26](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/profil/index.html#L26)<br>[skema/index.html#L97](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L97) |
| `<md-list-item>` | Én række i en liste (kan være et link eller en knap). | [list.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/list.md) | [list-item.ts](https://github.com/material-components/material-web/blob/v2.5.0/list/list-item.ts) | [login/login.js#L94](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/login.js#L94)<br>[noter/noter.js#L847](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L847)<br>[opgaver/opgaver.js#L221](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/opgaver.js#L221)<br>[profil/index.html#L27](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/profil/index.html#L27)<br>[skema/skema.js#L325](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L325) |
| `<md-divider>` | Tynd streg der deler indhold op. | [divider.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/divider.md) | [divider.ts](https://github.com/material-components/material-web/blob/v2.5.0/divider/divider.ts) | [karakter/index.html#L47](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/karakter/index.html#L47)<br>[login/index.html#L121](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L121)<br>[noter/index.html#L91](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L91)<br>[opgaver/index.html#L71](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L71) |

### Dialoger

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-dialog>` | Popup-vindue der kræver brugerens opmærksomhed. | [dialog.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/dialog.md) | [dialog.ts](https://github.com/material-components/material-web/blob/v2.5.0/dialog/dialog.ts) | [noter/index.html#L361](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L361)<br>[noter/noter.js#L818](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L818)<br>[opgaver/index.html#L87](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L87)<br>[skema/index.html#L81](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L81) |

### Kort (labs)

Flader der samler indhold om ét emne.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-filled-card>` | Kort med fyldt baggrund. | (labs, ingen docs endnu) | [filled-card.ts](https://github.com/material-components/material-web/blob/v2.5.0/labs/card/filled-card.ts) | [skema/skema.js#L194](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L194) |
| `<md-outlined-card>` | Kort med kant. | (labs, ingen docs endnu) | [outlined-card.ts](https://github.com/material-components/material-web/blob/v2.5.0/labs/card/outlined-card.ts) | [noter/noter.js#L406](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L406)<br>[skema/index.html#L24](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L24) |

### Ikoner og effekter

Ikoner og de små effekter der gør egne elementer klikbare.

| Tag | Hvad er det? | Docs | Kildekode | Brugt i |
| --- | --- | --- | --- | --- |
| `<md-icon>` | Viser et Material Symbols-ikon ud fra navnet, fx <code>&lt;md-icon&gt;home&lt;/md-icon&gt;</code>. Find navne på <a href="https://fonts.google.com/icons">fonts.google.com/icons</a>. | [icon.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/icon.md) | [icon.ts](https://github.com/material-components/material-web/blob/v2.5.0/icon/icon.ts) | [header/header.html#L19](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/header/header.html#L19)<br>[karakter/index.html#L59](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/karakter/index.html#L59)<br>[login/index.html#L36](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/index.html#L36)<br>[login/login.js#L95](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/login/login.js#L95)<br>[noter/index.html#L32](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/index.html#L32)<br>[noter/noter.js#L320](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L320)<br>[opgaver/index.html#L77](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/index.html#L77)<br>[opgaver/opgaver.js#L194](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/opgaver/opgaver.js#L194)<br>[profil/index.html#L28](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/profil/index.html#L28)<br>[skema/index.html#L36](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/index.html#L36)<br>[skema/skema.js#L214](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L214) |
| `<md-ripple>` | Bølgeeffekten når man klikker på et element. | [ripple.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/ripple.md) | [ripple.ts](https://github.com/material-components/material-web/blob/v2.5.0/ripple/ripple.ts) | [noter/noter.js#L392](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L392)<br>[skema/skema.js#L216](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L216) |
| `<md-focus-ring>` | Ringen der viser fokus når man bruger tastatur. | [focus-ring.md](https://github.com/material-components/material-web/blob/v2.5.0/docs/components/focus-ring.md) | [md-focus-ring.ts](https://github.com/material-components/material-web/blob/v2.5.0/focus/md-focus-ring.ts) | [noter/noter.js#L392](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/noter/noter.js#L392)<br>[skema/skema.js#L217](https://github.com/MrFawsDK/Lectioplus2/blob/main/public/skema/skema.js#L217) |

## Godt at vide

- **Labs**-komponenter (kort og segmenterede knapper) er eksperimentelle i material-web og kan ændre sig i nye versioner.
- `material.js` er committet, så Docker og serveren ikke behøver bygge noget. Husk at køre `npm run build:m3` og committe resultatet, når du ændrer `komponenter.js`.
- Filen fylder ca. 475 KB, fordi den ikke er minificeret. Det er bevidst, så den kan læses.
- `@material/web` og `esbuild` er kun `devDependencies`. De bruges kun til at bygge og kommer ikke med i Docker-imaget.
