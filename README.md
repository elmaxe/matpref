# Matpref

En PWA som hjälper oss att bestämma vad vi ska äta. Slumpa fram en rätt utifrån kategori, vem som äter och vad ni gillar.

- **Slumpa**: välj kategori (Fast, Storkok, Finmiddag), vem som äter och om det ska vara bland alla, favoriter, gillade eller nya rätter. Rätter som någon av de som äter ogillar tas bort, gillade rätter och favoriter kommer upp oftare och sådant ni lagat den senaste veckan mer sällan.
- **Recept**: alla rätter med sök och filter. Varje person kan sätta 👍 eller 👎.
- **Favoriter**: era gemensamma favoriter (♥).
- **Inspiration**: swipea recept från ICA, Arla, Coop och Köket.se. Rätter ni båda swipar höger på blir matchningar och hamnar bland era recept. Utan server finns exempelrecept att testa med. Under det: era egna rätter som ingen av er har testat än.
- **Vi**: namn och varje persons lista över vad den gillar och inte gillar, plus synk mellan telefoner.

Appen fungerar offline och kan installeras på hemskärmen ("Lägg till på hemskärmen" i Safari eller Chrome).

## Var sparas vad?

- **Recepten** ligger som JSON-filer i [`recipes/`](recipes/) och byggs in i appen. Nya recept läggs till med en pull request.
- **Allt ni gör i appen** (namn, betyg, favoriter, vad ni har lagat, swipes) sparas i en databas på telefonen (IndexedDB), så appen fungerar helt offline.
- **Med en egen server** synkas det mellan era telefoner när de når servern, och ni får recept från nätet att swipea. Se [`server/`](server/README.md).
- **Utan server** kan ni dela en länk under fliken *Vi* som slår ihop listorna på den andra telefonen.

## Lägga till ett recept

Enklast är knappen *Lägg till recept på GitHub* i appen, som öppnar en ny fil med en mall. Annars: skapa `recipes/<namn-med-bindestreck>.json` och öppna en PR.

```json
{
  "name": "Pasta carbonara",
  "category": "fast",
  "description": "Krämig klassiker med ägg, pecorino och sidfläsk.",
  "timeMinutes": 20,
  "servings": 2,
  "tags": ["pasta"],
  "ingredients": ["250 g spaghetti", "2 ägg"],
  "steps": ["Koka pastan.", "Blanda med ägg och ost."],
  "link": "https://exempel.se/recept"
}
```

Bara `name` och `category` (`fast`, `storkok` eller `finmiddag`) krävs. Filnamnet blir receptets id, så byt inte namn på en fil i efterhand (då tappar ni betygen för den). CI kör `npm run validate` på varje PR och säger till om något är fel.

## Utveckling

```sh
npm install
npm run dev       # startar på http://localhost:5173
npm test          # enhetstester
npm run build     # validerar recepten, typkontrollerar och bygger till dist/
```

## Publicering

Appen ligger på GitHub Pages och publiceras från grenen `gh-pages`, som skapas av workflowen första gången den körs.

- **Riktiga appen**: `.github/workflows/deploy.yml` bygger och lägger ut `main` på `https://<användare>.github.io/matpref/` vid varje push till `main`.
- **Förhandsvisningar**: `.github/workflows/preview.yml` bygger varje PR och lägger den på `https://<användare>.github.io/matpref/pr-preview/pr-<nummer>/`. En kommentar med länken (och en QR-kod för mobilen) dyker upp på PR:en och uppdateras vid varje push. När PR:en stängs eller mergas tas förhandsvisningen bort.

En förhandsvisning visar en banner överst och har en egen databas, separat från den riktiga appen. Den startar med en kopia av era riktiga listor men utan server, så ni kan testa med riktig data utan att röra den. Kopplar ni in samma server i förhandsvisningen delar den data med den riktiga appen.

Engångsinställning: *Settings → Pages → Build and deployment → Source: Deploy from a branch*, välj `gh-pages` och `/ (root)`.
