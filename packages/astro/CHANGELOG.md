## 0.5.0

- fix(astro): use data attribute for mse src to prevent premature fetch
- feat: require f:fmp4 format for MSE playback
- fix: correct codec option docs — it's a boolean (codec:1), not a value
- docs(astro): note that mse implies autoplay
- feat(astro): add mse prop to Video component for MediaSource playback

## 0.4.4

Version bump only (no changes).

## 0.4.3

- fix: exclude source files from published npm packages

## 0.4.2

- fix: lint

## 0.4.0

- chore: publish packages to npm instead of GitHub Packages

## 0.3.0

- feat(astro): read config from astro.config automatically
- feat(astro): add custom Video component
- feat(astro): add custom Image component and getImageUrl helper

## 0.2.0

- test: update image snapshots
- feat: ensure URL generator produces identical URLs to @imgproxy/imgproxy-node

## 0.1.0

Initial release.
