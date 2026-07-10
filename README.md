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
  ACES-tonemapping, avståndsdis och bergssiluetter för djup
- Hela scenen ritas på ~30 draw calls — instansering + geometri-merge
- Adaptiv kvalitet: sänker pixel ratio och skuggupplösning automatiskt om
  bilduppdateringen sjunker, så det rullar även på mobil

## Nästa steg

- Bilen (spelarfordon med fysik/styrning)
- Fler bilar på skärmen (motståndare/trafik)
- Ljud, HUD-varvtider, natt/skymningsläge
