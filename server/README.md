# Matpref-servern

En liten server (ASP.NET Core + SQLite) som två telefoner synkar mot, och som hämtar recept från nätet att swipea under *Inspiration*.

Appen är *local first*: allt sparas först i en databas på telefonen (IndexedDB) och fungerar helt offline, även swipen. Servern är en plats att synka till. När telefonen når den skickas ändringarna dit och den andra telefonens ändringar hämtas. Det som synkas är namn, betyg, favoriter, vad ni har lagat, swipes och borttagna matchningar. För varje sak vinner den senaste ändringen, oavsett vilken telefon den gjordes på.

Utan server visar Inspiration en liten lek med exempelrecept, så att ni kan testa swipen på en telefon genom att byta person.

## Hur leken fungerar

- Servern hämtar recept från **ICA, Arla, Coop och Köket.se**. Den läser sajternas egna sitemaps, väljer slumpvis bland receptsidorna och sparar bara titel, bild, kort beskrivning, tid, antal portioner och länk. Själva receptet läser ni på sajten.
- Bara middagsmat kommer med: efterrätter, bakning, drycker och tillbehör sorteras bort. Varje rätt får en gissad kategori (Snabbt, Storkok eller Finmiddag).
- **Servern bestämmer ordningen**: varje recept får en slumpad plats i leken när det importeras, och den är densamma för er båda. Telefonen hämtar recepten och visar dem i den ordningen, men först de rätter den andra redan har sagt ja till (där kan det bli match direkt). Det den andra har sagt nej till visas inte, eftersom det ändå inte kan bli match.
- **Match** blir det när ni båda har swipat höger. Det märks direkt på telefonen som swipar sist, och på den andra vid nästa synk.
- Importen kör var 12:e timme men hämtar bara när det finns färre än 150 rätter kvar som någon av er inte har swipat, högst 40 nya per sajt och med en paus mellan varje sida. Den första körningen sker när servern startar och tar upp till tio minuter.

## Starta på NAS:en

Kör ni TrueNAS, se [TrueNAS SCALE](#truenas-scale) nedan. Kör ni Tailscale utan egen reverse proxy, se [https-avsnittet](#appen-behöver-en-https-adress) och använd `docker-compose.tailscale.yml`. Annars: kopiera [`docker-compose.yml`](docker-compose.yml) till NAS:en och kör:

```sh
docker compose up -d
```

Imagen `ghcr.io/elmaxe/matpref-server` byggs för både x64 och arm64 av GitHub Actions vid varje ändring i `server/` på `main`. Vill du hellre bygga själv: byt `image:` mot `build: .` och kör i den här mappen.

Databasen ligger i volymen `matpref-data` (`/data/matpref.db` i containern). Kolla att det går: `curl http://<nas>:8080/api/health`.

### TrueNAS SCALE

TrueNAS SCALE 24.10 (Electric Eel) och senare kör appar med Docker och kan installera en egen compose-fil.

1. Skapa ett dataset för databasen, t.ex. `tank/apps/matpref` (*Datasets → Add Dataset*, välj förinställningen *Apps*). Ägaren ska vara användaren `apps` (568), som containern körs som.
2. Gå till *Apps → Discover Apps*, öppna menyn ⋮ uppe till höger och välj *Install via YAML*. Döp appen till `matpref` och klistra in:
   ```yaml
   services:
     matpref:
       image: ghcr.io/elmaxe/matpref-server:latest
       restart: unless-stopped
       # TrueNAS användare "apps", så att den kan skriva i datasetet.
       user: "568:568"
       ports:
         # Vänster sida är porten på NAS:en. Byt om 8080 redan används.
         - "8080:8080"
       volumes:
         # Byt mot sökvägen till ditt dataset.
         - /mnt/tank/apps/matpref:/data
       environment:
         TZ: Europe/Stockholm
         Matpref__Token: ""
         Matpref__AllowedOrigins__0: "https://elmaxe.github.io"
   ```
3. Peka din reverse proxy (t.ex. nginx) på `http://<nas>:8080` och lägg inte till egna CORS-headers där, det sköter servern. Kolla med `curl https://<din-adress>/api/health`.

Imagen läggs upp på GitHub när PR:en är mergad. Om TrueNAS inte får hämta den (fel om `denied` eller `unauthorized`), gör paketet publikt på GitHub: *Packages → matpref-server → Package settings → Change visibility*.

Behåll `:latest` i `image:`. Med en hash eller commit där får appen aldrig nya versioner, varken av sig själv eller med *Pull images*.

#### Uppdatera av sig själv efter merge

När en ändring i `server/` mergas bygger GitHub Actions imagen, ansluter till ert tailnet och ber TrueNAS hämta den nya imagen och starta om appen (samma sak som *Pull images* i TrueNAS). Tills inställningarna nedan finns hoppas det steget över. Kräver TrueNAS 25.04 eller senare.

1. **En https-adress till TrueNAS webbgränssnitt i tailnetet.** Lägg till en proxy host i Nginx Proxy Manager, t.ex. `truenas.tail.elmarsson.se`, med *Scheme* `https`, NAS:ens adress och TrueNAS https-port för webbgränssnittet (*System → General Settings → GUI*), slå på *Websockets Support* och ge den samma certifikat som matpref. Scheme måste vara `https`: kommer anropet okrypterat till TrueNAS spärrar den API-nyckeln första gången den används.
   Vill du hellre gå direkt till NAS:en (`https://<nas-namn eller tailscale-ip>`) med TrueNAS eget självsignerade certifikat, sätt variabeln `TRUENAS_SKIP_TLS_VERIFY` till `true` i steg 4. Trafiken är fortfarande krypterad, men certifikatet kontrolleras inte.
2. **En API-nyckel i TrueNAS.** Kontoikonen uppe till höger → *My API Keys* → *Add*, döp den till t.ex. `github-matpref`. Nyckeln har samma rättigheter som ditt konto, så lägg den bara som secret på GitHub.
3. **Tailscale.**
   - Under [Access controls](https://login.tailscale.com/admin/acls) lägger du till taggen som GitHub-maskinerna får: `"tagOwners": { "tag:ci": ["autogroup:admin"] }`. Har ni bara standardregeln som släpper igenom allt behövs inget mer, annars en regel som låter `tag:ci` nå NAS:en på porten i adressen från steg 1 (oftast 443).
   - Under [Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth) (heter *Trust credentials* i nyare versioner) skapar du en OAuth-klient med scope *Auth Keys: Write* och taggen `tag:ci`. Spara klient-id och hemligheten.
4. **GitHub.** I repot under *Settings → Secrets and variables → Actions*:
   | Namn | Typ | Värde |
   | --- | --- | --- |
   | `TS_OAUTH_CLIENT_ID` | Secret | Klient-id från Tailscale |
   | `TS_OAUTH_SECRET` | Secret | Hemligheten från Tailscale |
   | `TRUENAS_API_KEY` | Secret | API-nyckeln från TrueNAS |
   | `TRUENAS_URL` | Variable | Adressen från steg 1, t.ex. `https://truenas.tail.elmarsson.se` |
   | `TRUENAS_APP` | Variable (valfri) | Appens namn i TrueNAS, om det inte är `matpref` |
   | `TRUENAS_SKIP_TLS_VERIFY` | Variable (valfri) | `true` för TrueNAS självsignerade certifikat |
5. **Testa** under *Actions → Server-image → Run workflow* på `main`. Jobbet *deploy* ska sluta med "matpref kör nu den senaste imagen", och under *Vi → Server* i appen syns den nya versionen.

## Appen behöver en https-adress

Appen ligger på `https://elmaxe.github.io`, och en https-sida får inte anropa en `http://`-adress. Webbläsaren stoppar det (*mixed content*) innan anropet når servern, även om ni är på samma nätverk. Så `http://192.168.1.10:8080` fungerar inte i appen, utan servern behöver nås via https med ett giltigt certifikat. Några sätt, från enklast:

1. **Tailscale.** Slå först på *MagicDNS* och *HTTPS Certificates* under [DNS i Tailscales admin](https://login.tailscale.com/admin/dns). Sedan finns två sätt:
   - **Tailscale i compose-filen (rekommenderas).** Använd [`docker-compose.tailscale.yml`](docker-compose.tailscale.yml) i stället för `docker-compose.yml`. Då blir servern en egen maskin i ert tailnet, med certifikat som förnyas av sig själv, oavsett vad NAS:en kör. Skapa en auth key under [Settings → Keys](https://login.tailscale.com/admin/settings/keys), kopiera hela `server/`-mappen (compose-filen och `tailscale/serve.json`) till NAS:en och kör:
     ```sh
     TS_AUTHKEY=tskey-auth-... docker compose -f docker-compose.tailscale.yml up -d
     ```
     Adressen blir `https://matpref.<ert-tailnet>.ts.net` (namnet på ert tailnet står överst på DNS-sidan). Nyckeln behövs bara första gången.
   - **Tailscale direkt på NAS:en.** Om NAS:en redan är med i tailnetet kan den köra vanliga `docker-compose.yml` och sedan `tailscale serve --bg 8080`. Adressen blir då `https://<nas-namn>.<ert-tailnet>.ts.net`.
2. **NAS:ens egen reverse proxy.** Synology (*Inloggningsportal → Avancerat → Omvänd proxy*) och QNAP har en inbyggd. Peka en https-adress på `localhost:8080` och ge den ett Let's Encrypt-certifikat, till exempel för Synologys gratis DDNS-namn (`<namn>.synology.me`) eller en egen domän.
3. **Caddy eller Traefik** framför containern med ett eget domännamn och Let's Encrypt via DNS-utmaning, om ni redan kör något sådant.

Med en vanlig WireGuard/OpenVPN-tunnel och bara en IP-adress finns inget certifikat att få, och då går det inte från GitHub Pages. Säg till i så fall, så kan servern i stället även servera appen själv över http (då går den inte att installera som app eller använda offline).

## Koppla in appen

Under fliken **Vi → Server**: fyll i adressen, välj vem som använder telefonen och tryck *Spara och synka*. Gör samma sak på den andra telefonen och välj den andra personen. Det som redan finns på telefonerna slås ihop.

## Inställningar

Allt finns i [`appsettings.json`](Matpref.Server/appsettings.json) och kan skrivas över med miljövariabler i `docker-compose.yml` (dubbla understreck för nivåer).

| Miljövariabel | Standard | Vad |
| --- | --- | --- |
| `Matpref__Token` | tom | Delad nyckel. Om den är satt måste appen skicka samma nyckel (fylls i under Vi). |
| `Matpref__AllowedOrigins__0` | `https://elmaxe.github.io` | Webbadresser som får anropa servern från webbläsaren (CORS). Lägg till fler med `__1`, `__2` osv. |
| `Import__Enabled` | `true` | Stäng av importen helt. |
| `Import__IntervalHours` | `12` | Hur ofta importen kollar om det behövs fler recept. |
| `Import__TargetUnswiped` | `150` | Hämta fler när färre än så här finns kvar att swipea. |
| `Import__MaxNewPerSource` | `40` | Max nya recept per sajt och körning. |
| `Import__DelayMs` | `1500` | Paus mellan sidor. |
| `Logging__LogLevel__Default` | `Information` | `Debug` eller `Trace` för mer loggning. `Logging__LogLevel__Microsoft.AspNetCore: Information` loggar varje anrop. |

Fler källor läggs till under `Import:Sources` i `appsettings.json`: ett namn, en eller flera sitemaps, och reguljära uttryck för vilka undersitemaps (`SitemapPattern`) och sidor (`UrlPattern`) som är recept. Sajten behöver ha schema.org/Recipe-data på receptsidorna, vilket nästan alla receptsajter har.

## API

Har servern en nyckel måste alla anrop under `/api` skicka den, som headern `X-Matpref-Token` eller som `?token=` i adressen: `curl -H "X-Matpref-Token: <nyckel>" https://<din-adress>/api/version`. Appen använder `?token=` och skickar JSON som `text/plain`, så att webbläsaren skickar anropen direkt utan att fråga servern först (CORS-preflight).

| Anrop | Vad |
| --- | --- |
| `GET /healthz` | Svarar `ok`, utan nyckel. Används av Dockers health check. |
| `GET /api/health` | Antal recept per källa och om en import pågår. |
| `GET /api/version` | Vilken version servern kör (commitens korta hash) och när den byggdes. Visas i appen under Vi. |
| `POST /api/sync` `{ "databaseId", "cursor", "changes": [{ "key", "value", "updatedAt", "device" }] }` | Skicka telefonens ändringar och få allt nytt sedan `cursor`. Nycklar: `name/a`, `rating/a/<recept>`, `favorite/<recept>`, `cooked/<recept>`, `swipe/a/<recept>`, `hidden/<recept>`, `recipe/<recept>` (själva receptet). |
| `GET /api/recipes?after=<id>&limit=500` | Recept från nätet med id större än `after`, med sin plats (`rank`) i leken. |
| `GET /api/fetch-recipe?url=<länk>` | Hämtar en receptsida och läser ut receptet (namn, ingredienser, steg osv.) ur dess schema.org-data. Används när man lägger till ett recept från en länk i appen. |
| `POST /api/import` | Kör en import nu. |

## Utveckling

Kräver .NET 10 SDK.

```sh
cd server
dotnet test
Matpref__DatabasePath=./dev.db dotnet run --project Matpref.Server --urls http://localhost:5080
```

Starta appen med `npm run dev` och fyll i `http://localhost:5080` under Vi. Lokalt går det med http, eftersom appen då också körs över http.
