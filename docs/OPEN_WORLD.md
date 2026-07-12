# Öppen värld — Design & plan (Distrikt 1: Finanskvarteren)

Levande dokument. Nordstjärna för bygget av den fria staden. Uppdateras allt eftersom.

> **Status:** Fas 1 + **Fas 2 byggda** — kör på `?world=1`. Ett 5×5-rutnät (500 m)
> med fri körning, gatunät med korsningar, nära-sidans trafikljus per korsning (synkade),
> upphöjda trottoarer, glas/betong-hus med varierade fasader och entréer, rivbara stolpar,
> och ett **centralt torg** (fontän, staty, träd, gungställning). Rutnäts-medveten krock.
> **Fas 3 byggd:** biltrafik (`traffic_world.js`) med de riktiga GLB-bilmodellerna
> (taxi/sedan/SUV/sport/polis) som ruttar rutnätet, stannar för rött, följer och bromsar
> för spelaren — med bromsljus. **Fas 4 byggd:** fotgängare (`pedestrians_world.js`) —
> animerade karaktärer som strosar kvarterens trottoarer och **väjer för bilen** istället
> för att bli överkörda. Nästa: Fas 5 (distrikt-variation + detaljpass). Moduler:
> `citymodel.js` (grid-data), `world.js` (geometri + torg), `signals.js` (ljus),
> `traffic_world.js` (bilar), `pedestrians_world.js` (folk), `collision.js` (krock);
> fri körning bakom `world`-flaggan i `drive.js`.

> Kort: bilen är idag fastlimmad vid en spline (banan). Öppen värld = ta bort den
> klämman och ersätta med **gatunät + krockhantering**. Allt annat (trafikljus,
> papperskorgar, fontäner, gungor) är innehåll ovanpå det fundamentet.

## Låsta vägval

1. **Vertikal skiva först.** Bygg EN korsning + kringliggande kvarter *helt klart*
   (fri körning, krock, trafikljus, trottoar, prylar) innan vi tilar ut till hela
   distriktet. Det svåra bevisas tidigt.
2. **Rutnät + landmärken.** Mestadels rutnät, men med ett centralt torg/park
   (fontän, staty, gungor), en diagonal aveny och några signaturhus. Inte monotont.
3. **Fri körning blir standard; banan blir race-event.** Behåll `track.js` + splinen
   och attract-kamerorna, men bakom ett "race mode". Grundläget är fri roaming.

## Skala & filosofi

- **500 × 500 m = Distrikt 1.** ~4–5 kvarter per håll (kvarter ~90 m, gata ~14 m med
  trottoar). Ett litet men äkta grannskap.
- **Designat för att tila.** Distrikt 1 är första biten av en större stad (4–5 distrikt
  runt en ringled, enligt tidigare plan). Vi bygger inte en isolerad ö.
- **PS2/PS3-fidelity är ett val, inte en brist.** Vi kan aldrig matcha AAA i polygoner.
  Vår väg till "detaljerat" är **instansiering + aktiveringsrutnät**, inte polygon-count.
  Allt (papperskorg, lykta, person) är billigt om det instansieras och bara animeras nära
  spelaren.

## Arkitektur — lager (byggs nedifrån och upp)

### 1. Stadsmodell (ryggraden)
Ett deterministiskt data-rutnät som *allt annat* läser från. Ingen geometri här — bara
siffror. Seedat så det är reproducerbart.

```
CityModel = {
  seed,
  cellSize,                 // kvarter-pitch, ~104 m (90 kvarter + 14 gata)
  cols, rows,               // t.ex. 5 × 5
  intersections: [ { x, z, type: '4way'|'T', signalId } ],
  streets:       [ { a, b, width, lanes } ],            // segment mellan korsningar
  blocks:        [ { x, z, w, d, kind, seed } ],        // kind: building | plaza | park
  landmarks:     [ { cell, kind } ],                    // override specifika celler
}
```
Geometri, krock-colliders, trafik-graf, trottoar-graf och pryl-placering **genereras alla
från modellen**. Ändrar vi modellen ändras allt konsekvent.

### 2. Gator & trottoarer
- Körbar asfalt-yta med linjer + övergångsställen vid korsningar.
- **Kantsten** (~0.15 m) skiljer väg från trottoar → mjuk krockgräns (går att tjuvkoppla upp
  på trottoaren med en studs + inbromsning, inte en osynlig vägg).
- Återanvänder `buildRibbon`/vägtexturerna vi redan har.

### 3. Korsningar & trafikljus
- En signal-state-machine per korsning: **grön → gul → röd**, N–S och Ö–V i motfas,
  konfigurerbar fas-timing.
- 4 ljushuvuden per korsning (ett per tillfart). Registreras i `night.js` så de glöder på
  natten (samma mönster som gatlyktorna).
- Trafik och (senare) fotgängare läser signalläget.

### 4. Hus
- **Behåll våra procedurella fasader** (`city.js`, `textures.js`) — de ser redan bra ut och
  har natt-fönster via emissive-registret.
- Arrangeras per kvarter från modellen istället för längs en spline.
- Bottenvåningar med skyltfönster/kiosker för gatuliv.
- Några **signaturtorn** högre än rutnätet som landmärken.

### 5. Prylar (detaljlagret)
- **Instansierade** (en draw call var): papperskorg, hydrant, gatuskylt, lykta, bänk,
  träd, busskur, tidningskiosk, stolpar.
- **Hjälte-objekt** (unika): fontän, staty, monument, gungställning i parken.
- Källa: Kenney/Poly Pizza CC0-kit vi redan börjat samla (se `assets/` + scratchpad-crawl:
  bench, hydrant, traffic light, trash, street sign, bus stop). Licenskoll per modell,
  kurering in i `assets/kits/`.

### 6. Biltrafik
- Uppgradering av dagens 10-bils-loop till agenter på **väg-grafen**: noder =
  korsningar/lane-ändar, kanter = lane-segment.
- Bilar väljer rutt, **stannar för rött**, svänger i korsningar, ger företräde.
- Återanvänder trafik-bilmodellerna + glow-lights vi har.

### 7. Fotgängare
- Uppgradering av dagens publik till agenter på en **trottoar-graf** med
  övergångsställen.
- Aktiviteter: går, väntar vid rött, sitter på bänk, står vid kiosk.
- Återanvänder bakade poser + billboard-horde-tricket för avstånd.

### 8. Krockhantering (nytt system)
- Statiska colliders från modellen: **hus som AABB-boxar**, kantsten som linjesegment.
- **Broadphase:** rutnäts-celler (bilen kollar bara sin cell + grannar). Trivialt i skivan,
  nödvändigt när vi tilar.
- **Lösning:** cirkel (bilen) vs AABB push-out (hus = hårt), vs kantsten-segment (mjuk
  studs + fartskrap). Ersätter korridor-klämman i `drive.js`.

### 9. Prestanda — aktiveringsrutnät
- Dela världen i celler. **Instansiera/animera bara agenter (bilar, folk) och detaljprylar
  inom R meter från spelaren.** Avlägsna kvarter = bara statisk instansierad geometri.
- Hus alltid synliga (instansierade, billiga). LOD där det behövs (crowd gör redan
  billboard-tricket).
- Adaptiva kvalitetstiers finns redan (`autoQuality`).

### 10. Kamera / minimap / HUD
- Chase-kameran funkar som den är. Attract/trackside-kameror gatas till race mode.
- Minimap → riktig stadskarta (rutnät + spelarpil finns redan som grund).

## Byggordning (faser — testbart efter varje)

| Fas | Innehåll | Bevisar |
|---|---|---|
| **1. Skiva** | En korsning + kvarter-ring (~120×120 m): fri körning, kantsten-krock, ETT trafikljus, trottoar, några prylar | Hela kärnan: fri roaming + krock + signal |
| **2. Tila** | Multiplicera till 5×5-rutnätet + centralt torg/park | Stadsmodellen skalar |
| **3. Trafik** | Bilar ruttar grafen, lyder ljusen, svänger | Väg-graf + signal-koppling |
| **4. Folk** | Fotgängare med aktiviteter, övergångsställen | Trottoar-graf |
| **5. Detalj** | Alla prylar, monument, fontän, gungor, kiosker | Innehållstäthet |
| **6. Polish** | Natt-integration, prestanda, minimap-karta, race-mode-växel | Helhet |

## Vertikal skiva — detaljspec (det vi bygger först)

**Mål:** ~120×120 m runt en 4-vägskorsning. Kör fritt, krocka mot hus/kantsten, ett
fungerande trafikljus, trottoarer, en handfull instansierade prylar. Ingen trafik/folk än.

- **Layout:** två ~14 m-gator korsar; de fyra hörnkvarteren byggda med trottoar +
  ett hus vardera (bottenvåning med skyltfönster).
- **Körbar yta:** asfalt + linjer + övergångsställen; kantsten ~0.15 m runt trottoarerna.
- **Fri körning:** i `drive.js`, bakom en `mode`-flagga:
  - Ta bort spline-korridor-klämman (`refineS`/`frameAt`-vägen) i free-roam.
  - Krock mot hus-AABB (hårt) + kantsten (mjuk studs + skrap).
  - Styrning/fysik i övrigt oförändrad.
- **Trafikljus:** en `SignalController` vid korsningen, 4 huvuden, N–S grön / Ö–V röd med
  gul-övergångar, registrerad i `night.js`.
- **Krock (minimal men rätt form):** collider-lista (AABB + segment) + cirkel-vs-box-lösning.
  Broadphase designas som rutnät men skivan är liten nog för brute force.
- **Prylar:** 4 ljusstolpar, ett par papperskorgar, gatuskyltar, lyktor, bänkar, träd —
  alla instansierade.
- **Race-mode-gate:** attract/trackside-kameror + lap-logik flyttas bakom `mode === 'race'`
  så free-roam är rent.

## Landmärken (av vägval 2)

- Centralt **torg**: fontän + staty + bänkar.
- Liten **park** i ett kvarter: träd, gräs, **gungställning** i ett hörn.
- En **diagonal aveny** som bryter rutnätet i ett hörn.
- 2–3 **signaturtorn** högre än övriga.

## Öppna frågor / senare

- Minimap → full pan/zoom-stadskarta.
- Polis-AI (jakter), uppdragsramverk (timer/skada/felony), Film Director-replay.
- Garage-tutorial (Driver-hyllning) — avgränsat, byggs separat.
- Skademodell på bilen.
- Ev. mer Driver-körkänsla (tyngre bakvagn, växellåda, kamera-tyngd) om vi vill särskilja
  feelet från "generisk arkadracer".
