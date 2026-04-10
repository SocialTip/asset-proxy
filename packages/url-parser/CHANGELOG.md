## 0.7.1

- fix: exclude source files from published npm packages

## 0.7.0

- fix: lint
- feat: validate that exar requires resize dimensions
- feat: add cuvid GPU scaler using decoder-level resize
- feat: return 429 with Retry-After when GPU slot cannot be acquired within 5s

## 0.6.2

- feat: return 429 with Retry-After when GPU slot cannot be acquired within 5s

## 0.6.0

- chore: publish packages to npm instead of GitHub Packages
- feat: format:best always resolves to MP4 for video output
- refactor: use tsx with source export conditions for server coverage
- refactor: replace custom coverage merge with monocart-coverage-reports

## 0.5.0

- fix: use scale_cuda for GPU video resize instead of cuvid -resize
- docs: documented videoThumbnailAnimation options
- feat: support fill, extendFrame, trim, and focus point in VTA
- feat(proxy): add page info option, inline snapshots for validation tests
- refactor: add zod schema for info control options, add max_src_resolution
- feat(proxy): add hashsum verification and source limits to info endpoint
- feat(proxy): add calc_hashsums info option
- feat(proxy): add blurhash info option
- feat(proxy): add dominant colours info option
- feat(proxy): add average colour info option
- feat(proxy): add palette info option
- refactor: move info URL option parsing to url-parser package

## 0.4.1

- fix: preserve JSDoc on ParsedUrlInput in declaration output
- feat: add resizingAlgorithm to parsedUrlSchema and URL generator

## 0.4.0

- feat: add mute option to strip audio from video (ST-2456)
- fix: allow image-only options with video thumbnail extraction (ST-2541)
- feat: add security limit options (ST-2501)
- feat: add miscellaneous imgproxy options (ST-2500)

## 0.3.0

- feat: ensure URL generator produces identical URLs to @imgproxy/imgproxy-node
- feat: add best format selection for images

## 0.2.0

- refactor: standardise tsconfig pattern and add path aliases across all packages

## 0.1.0

Initial release with `@socialtip`-scoped packages.
