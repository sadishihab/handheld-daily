# Handheld Daily

A mobile game front-end styled as a retro LCD handheld: monochrome green pixel
text on a dark screen.

Vanilla HTML, CSS, and JavaScript — no framework, no build step, no dependencies.

## Structure

```
index.html      # the page
src/main.js     # input behavior (no pinch/double-tap zoom, no long-press menu)
styles/main.css # LCD screen styling
```

## Running it

Open `index.html` in a browser, or serve the folder to test on a phone:

```sh
python3 -m http.server 8000
```

Then visit `http://<your-machine-ip>:8000` from the device.
