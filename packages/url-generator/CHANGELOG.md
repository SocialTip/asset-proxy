## 0.6.3

- release: bump package versions
- fix: lint

## 0.6.2

- fix: lint

## 0.6.0

- chore: publish packages to npm instead of GitHub Packages
- refactor: use tsx with source export conditions for server coverage

## 0.5.0

- fix: include info options in signature computation in generateInfoUrl
- feat: support fill, extendFrame, trim, and focus point in VTA
- feat(proxy): add page info option, inline snapshots for validation tests
- feat(proxy): add calc_hashsums info option
- feat(proxy): add blurhash info option
- feat(proxy): add dominant colours info option
- feat(proxy): add average colour info option
- feat(proxy): add palette info option
- refactor: move info URL option parsing to url-parser package
- feat(proxy): add bands, sample_format, pages_number, alpha info options
- fix: make colorspace an opt-in info option (cs:1)
- feat(proxy): add XMP metadata option to info endpoint
- feat(proxy): add IPTC metadata option to info endpoint
- feat(proxy): add EXIF metadata option to info endpoint
- test(url-generator): add imgproxy backcompat tests for generateInfoUrl

## 0.4.1

- test: include resize dimensions in resizing algorithm tests
- feat: add resizingAlgorithm to parsedUrlSchema and URL generator

## 0.4.0

- feat: add /info/ endpoint for source asset metadata (ST-2517)
- feat: add mute option to strip audio from video (ST-2456)
- feat: add security limit options (ST-2501)
- feat: add miscellaneous imgproxy options (ST-2500)

## 0.3.0

- feat: ensure URL generator produces identical URLs to @imgproxy/imgproxy-node
- feat: add best format selection for images

## 0.2.0

- refactor: standardise tsconfig pattern and add path aliases across all packages

## 0.1.0

Initial release with `@socialtip`-scoped packages.
