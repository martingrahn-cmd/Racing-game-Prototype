# APEX CITY — Racing game prototype

Ett racingspel-prototyp byggt med **noll externa assets** — ingen bil ännu, bara banan
och staden. Allt (asfalt, fasader, staket, banderoller, himmel, moln) genereras
procedurellt i kod vid start. Ridge Racer-inspirerad stadsbana i dagsljus.

![Chase-kamera under sponsorportal](docs/screenshot-chase.png)

## Kör

Statisk sida, ingen build behövs — men ES-moduler kräver en webbserver:

```bash
python3 -m http.server 8000
# öppna http://localhost:8000
```

Funkar även direkt på GitHub Pages (Settings → Pages → deploy from branch).

## Kontroller

| Input | Funktion |
|---|---|
| `C` / mellanslag / tryck på skärmen | Byt kamera (chase → bumper → helikopter → TV) |
| `↑` / `↓` (eller `+` / `−`) | Ändra fart (90–300 km/h) |

Utan input går spelet i *attract mode* och klipper mellan kamerorna själv.
URL-parametrar för felsökning: `?s=520&cam=2&speed=4` (position på banan, kamera, fart).

## Fler vyer

![Bumper-kamera mot startportalen](docs/screenshot-bumper.png)
![Helikoptervy över staden](docs/screenshot-heli.png)

## Teknik

- **Three.js** (vendorerad i `vendor/`, inga CDN-beroenden — funkar offline)
- Banan är en sluten Catmull-Rom-spline (~2 km); väg, kantsten, trottoar och
  fångststaket extruderas som ribbons längs splinen
- ~1500 byggnader som `InstancedMesh` (3 fasadtyper × procedurella canvas-texturer),
  butiksfasader i gatuplan, tak med egen material-grupp
- Sol + skuggkarta som följer kameran, himmel i shader, IBL via PMREM från himlen,
  avståndsdis och bergssiluetter för djup
- **Post-processing i HDR** (egen pipeline, inga addons): bloom, radiell motion blur
  i fart, chromatic aberration, ACES-tonemapping, färggradering, vinjett, filmkorn
- **Materialdjup**: normal- och roughness-maps genereras ur höjdkartor i canvas —
  fönster ligger infällda i fasaderna och glas fångar sol/himmel; asfalten har
  polerade däckspårband, sprickor och tjärskarvar
- Kontaktskuggor (fejk-AO) under alla byggnader och träd, tornavsatser med antenner,
  väggreklamer, brunnslock, däckspår genom kurvorna, röd/vit kurvkantsten bara i kurvor
- Hela scenen ritas på ~40 draw calls — instansering + geometri-merge
- Adaptiv kvalitet: sänker pixel ratio och skuggupplösning automatiskt om
  bilduppdateringen sjunker, så det rullar även på mobil

## Byt ut bilen mot en riktig modell

En procedurell platshållarbil kör banan direkt. För snyggare bil: ladda ner en fri
modell och lägg den som **`assets/car.glb`** — spelet hittar den automatiskt,
skalar den till rätt längd och ställer den på vägen. Pekar modellen åt fel håll,
justera med URL-parametern `?carRot=90` (eller 180/270).

Bra gratiskällor (GLB/glTF, testade licenser):

| Källa | Licens | Kommentar |
|---|---|---|
| [Kenney — Car Kit](https://kenney.nl/assets/car-kit) | CC0 | 40+ bilar, glTF ingår, perfekt stilnivå |
| [Kenney — Racing Kit](https://kenney.nl/assets/racing-kit) | CC0 | Racingbilar + banrekvisita |
| [Quaternius — Cars Pack](https://quaternius.com/packs/cars.html) | CC0 | 8 bilar (sport, taxi, polis, SUV) |
| [Quaternius Cars Bundle på Poly Pizza](https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk) | CC0 | Samma paket, direkt GLB-nedladdning |
| [Poly Pizza — sök "car"](https://poly.pizza/) | CC0/CC-BY | 1000-tals modeller, filtrera på licens |
| [Sketchfab — downloadable](https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&q=car&type=models) | CC0-filter | Högre detaljnivå, kolla polycount |

CC0 = public domain: fritt att använda, ändra och committa i repot utan attribution.
(CC-BY kräver att upphovspersonen krediteras, t.ex. här i README.)

## Nästa steg

- Riktig bilmodell enligt ovan
- Fysik/styrning (spelarkontroll istället för attract mode)
- Fler bilar på skärmen (motståndare/trafik)
- Ljud, HUD-varvtider, natt/skymningsläge
