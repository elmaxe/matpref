# Matpref-servern

En liten server (ASP.NET Core + SQLite) som gör det möjligt att swipea recept från nätet under *Inspiration* i appen. Swipa höger på det du vill äta; när ni båda har swipat höger på samma rätt blir det en match. Matchningarna sparas på servern och dyker upp i appen bland era recept, så att de kan slumpas, gillas och bli favoriter.

Resten av appen fungerar som förut utan server.

## Hur leken fungerar

- Servern hämtar recept från **ICA, Arla, Coop och Köket.se**. Den läser sajternas egna sitemaps, väljer slumpvis bland receptsidorna och sparar bara titel, bild, kort beskrivning, tid, antal portioner och länk. Själva receptet läser ni på sajten.
- Bara middagsmat kommer med: efterrätter, bakning, drycker och tillbehör sorteras bort. Varje rätt får en gissad kategori (Fast, Storkok eller Finmiddag).
- **Servern bestämmer ordningen**, och den är densamma för er båda. Först kommer rätter den andra redan har sagt ja till (där kan det bli match direkt), sedan resten i en gemensam slumpad ordning. Det den andra har sagt nej till visas inte, eftersom det ändå inte kan bli match.
- Importen kör var 12:e timme men hämtar bara när det finns färre än 150 rätter kvar som någon av er inte har swipat, högst 40 nya per sajt och med en paus mellan varje sida. Den första körningen sker när servern startar och tar upp till tio minuter.

## Starta på NAS:en

Kopiera [`docker-compose.yml`](docker-compose.yml) till NAS:en och kör:

```sh
docker compose up -d
```

Imagen `ghcr.io/elmaxe/matpref-server` byggs för både x64 och arm64 av GitHub Actions vid varje ändring i `server/` på `main`. Vill du hellre bygga själv: byt `image:` mot `build: .` och kör i den här mappen.

Databasen ligger i volymen `matpref-data` (`/data/matpref.db` i containern). Kolla att det går: `curl http://<nas>:8080/api/health`.

## Appen behöver en https-adress

Appen ligger på `https://elmaxe.github.io`, och en https-sida får inte anropa en `http://`-adress. Webbläsaren stoppar det (*mixed content*) innan anropet når servern, även om ni är på samma nätverk. Så `http://192.168.1.10:8080` fungerar inte i appen, utan servern behöver nås via https med ett giltigt certifikat. Några sätt, från enklast:

1. **Tailscale.** Om er VPN är Tailscale: slå på *MagicDNS* och *HTTPS Certificates* under DNS i Tailscales admin, och kör sedan på NAS:en:
   ```sh
   tailscale serve --bg 8080
   ```
   Då nås servern på `https://<nas-namn>.<ert-tailnet>.ts.net` med ett riktigt certifikat, bara inifrån ert tailnet. Det är adressen ni skriver in i appen.
2. **NAS:ens egen reverse proxy.** Synology (*Inloggningsportal → Avancerat → Omvänd proxy*) och QNAP har en inbyggd. Peka en https-adress på `localhost:8080` och ge den ett Let's Encrypt-certifikat, till exempel för Synologys gratis DDNS-namn (`<namn>.synology.me`) eller en egen domän.
3. **Caddy eller Traefik** framför containern med ett eget domännamn och Let's Encrypt via DNS-utmaning, om ni redan kör något sådant.

Med en vanlig WireGuard/OpenVPN-tunnel och bara en IP-adress finns inget certifikat att få, och då går det inte från GitHub Pages. Säg till i så fall, så kan servern i stället även servera appen själv över http (då går den inte att installera som app eller använda offline).

## Koppla in appen

Under fliken **Vi → Server för swipe**: fyll i adressen, välj vem som använder telefonen och tryck *Testa anslutningen*. Gör samma sak på den andra telefonen och välj den andra personen.

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

Fler källor läggs till under `Import:Sources` i `appsettings.json`: ett namn, en eller flera sitemaps, och reguljära uttryck för vilka undersitemaps (`SitemapPattern`) och sidor (`UrlPattern`) som är recept. Sajten behöver ha schema.org/Recipe-data på receptsidorna, vilket nästan alla receptsajter har.

## API

| Anrop | Vad |
| --- | --- |
| `GET /api/health` | Antal recept per källa och om en import pågår. |
| `GET /api/deck?user=a&limit=20&category=fast` | Nästa kort för person `a` eller `b`, plus hur många som är kvar. |
| `POST /api/swipes` `{ "user": "a", "recipeId": 1, "liked": true }` | Spara en swipe. Svarar med receptet i `match` om det blev match. |
| `DELETE /api/swipes/{user}/{recipeId}` | Ångra en swipe. |
| `GET /api/matches` | Era matchningar, senaste först. |
| `DELETE /api/matches/{recipeId}` | Ta bort en matchning från listan. |
| `POST /api/import` | Kör en import nu. |

## Utveckling

Kräver .NET 10 SDK.

```sh
cd server
dotnet test
Matpref__DatabasePath=./dev.db dotnet run --project Matpref.Server --urls http://localhost:5080
```

Starta appen med `npm run dev` och fyll i `http://localhost:5080` under Vi. Lokalt går det med http, eftersom appen då också körs över http.
