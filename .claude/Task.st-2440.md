# ST-2440: imgproxy Processing Features

Reference: https://docs.imgproxy.net/usage/processing

Legend:

- [x] = Implemented
- [ ] = Not implemented
- **Pro** = Requires imgproxy Pro
- Status: MERGED = fully done, IN PROGRESS = partially done, (no tag) = backlog

---

## ST-2474: Resize [IN PROGRESS]

- [x] `resize` / `rs` — resize with type, width, height, enlarge, extend
- [x] `size` / `s` — shorthand for width + height
- [x] `resizing_type` / `rt` — fit, fill, fill-down, force, auto
- [ ] `resizing_algorithm` / `ra` — nearest, linear, cubic, lanczos2, lanczos3 **Pro**
- [x] `width` / `w`
- [x] `height` / `h`

## ST-2475: Min Dimensions [MERGED]

- [x] `min_width` / `mw`
- [x] `min_height` / `mh`

## ST-2476: Zoom [MERGED]

- [x] `zoom` / `z` — zoom_x, zoom_y

## ST-2477: DPR [MERGED]

- [x] `dpr` — device pixel ratio multiplier

## ST-2478: Enlarge [MERGED]

- [x] `enlarge` / `el` — allow upscaling

## ST-2479: Extend [MERGED]

- [x] `extend` / `ex` — pad undersized images with gravity
- [x] `extend_aspect_ratio` / `exar` — extend to match aspect ratio

## ST-2480: Gravity [IN PROGRESS]

- [x] `gravity` / `g` — no, so, ea, we, noea, nowe, soea, sowe, ce
- [ ] `gravity:sm` — smart gravity **Pro**
- [ ] `gravity:obj` — object-oriented gravity **Pro**
- [ ] `gravity:objw` — weighted objects gravity **Pro**
- [ ] `gravity:fp` — focus point gravity
- [ ] `objects_position` / `op` **Pro**

## ST-2481: Crop [IN PROGRESS]

- [x] `crop` / `c` — width, height, gravity
- [ ] `crop_aspect_ratio` / `car` **Pro**

## ST-2482: Trim (image)

- [ ] `trim` — threshold, colour, equal_hor, equal_vert

## ST-2483: Padding [MERGED]

- [x] `padding` / `pd` — top, right, bottom, left

## ST-2484: Rotation [MERGED]

- [x] `auto_rotate` / `ar`
- [x] `rotate` / `rot` — 0, 90, 180, 270

## ST-2485: Flip

- [ ] `flip` — horizontal, vertical

## ST-2486: Background [IN PROGRESS]

- [x] `background` / `bg` — hex or R:G:B
- [ ] `background_alpha` / `bga` **Pro**

## ST-2487: Colour Adjustments **Pro**

- [ ] `adjust` / `a` — brightness, contrast, saturation **Pro**
- [ ] `brightness` / `br` **Pro**
- [ ] `contrast` / `co` **Pro**
- [ ] `saturation` / `sa` **Pro**
- [ ] `monochrome` / `mc` **Pro**
- [ ] `duotone` / `dt` **Pro**

## ST-2488: Blur [MERGED]

- [x] `blur` / `bl` — gaussian blur sigma

## ST-2489: Sharpen [MERGED]

- [x] `sharpen` / `sh` — sigma

## ST-2490: Pixelate

- [ ] `pixelate` / `px` — size

## ST-2491: Advanced Filters **Pro**

- [ ] `unsharp_masking` / `ush` — mode, weight, divider **Pro**
- [ ] `blur_areas` / `bla` **Pro**
- [ ] `blur_detections` / `bld` **Pro**
- [ ] `draw_detections` / `dd` **Pro**
- [ ] `colorize` / `clrz` **Pro**
- [ ] `gradient` / `grd` **Pro**

## ST-2502: Watermark

- [ ] `watermark` / `wm` — opacity, position, offset, scale
- [ ] `watermark_url` / `wmu` **Pro**
- [ ] `watermark_text` / `wmt` **Pro**
- [ ] `watermark_size` / `wms` **Pro**
- [ ] `watermark_rotate` / `wmr` **Pro**
- [ ] `watermark_shadow` / `wmsh` **Pro**
- [ ] `style` / `st` **Pro**

## ST-2494: Strip Metadata [IN PROGRESS]

- [x] `strip_metadata` / `sm`
- [ ] `keep_copyright` / `kc`
- [ ] `strip_color_profile` / `scp`
- [ ] `color_profile` / `cp` **Pro**

## ST-2495: DPI **Pro**

- [ ] `dpi` **Pro**

## ST-2499: Enforce Thumbnail

- [ ] `enforce_thumbnail` / `eth`

## ST-2492: Quality [IN PROGRESS]

- [x] `quality` / `q` — 1-100 percentage
- [ ] `format_quality` / `fq` — per-format quality
- [ ] `autoquality` / `aq` **Pro**
- [ ] `max_bytes` / `mb`

## ST-2496: Format-specific Options **Pro**

- [ ] `jpeg_options` / `jpgo` — progressive, no_subsample, trellis_quant, overshoot_deringing, optimize_scans, quant_table **Pro**
- [ ] `png_options` / `pngo` — interlaced, quantize, quantization_colours **Pro**
- [ ] `webp_options` / `wpo` — compression, smart_subsample, preset **Pro**
- [ ] `avif_options` / `avo` — subsample **Pro**

## ST-2493: Format [IN PROGRESS]

- [x] `format` / `f` — jpg, png, webp, avif, gif
- [ ] `format:best` — auto-select best format **Pro**

## ST-2497: Pages & Animation **Pro**

- [ ] `page` / `pg` **Pro**
- [ ] `pages` / `pgs` **Pro**
- [ ] `disable_animation` / `da` **Pro**

## ST-2498: Video Thumbnails **Pro**

- [ ] `video_thumbnail_second` / `vts` **Pro**
- [ ] `video_thumbnail_keyframes` / `vtk` **Pro**
- [ ] `video_thumbnail_tile` / `vtt` **Pro**
- [ ] `video_thumbnail_animation` / `vta` **Pro**

## ST-2500: Miscellaneous

- [ ] `fallback_image_url` / `fiu` **Pro**
- [ ] `skip_processing` / `skp`
- [ ] `raw` / `raw`
- [ ] `cache_buster` / `cb`
- [ ] `expires` / `exp`
- [ ] `filename` / `fn`
- [ ] `return_attachment` / `att`
- [ ] `preset` / `pr`
- [ ] `hashsum` / `hs` **Pro**

## ST-2501: Security Options

- [ ] `max_src_resolution` / `msr`
- [ ] `max_src_file_size` / `msfs`
- [ ] `max_animation_frames` / `maf`
- [ ] `max_animation_frame_resolution` / `mafr`
- [ ] `max_result_dimension` / `mrd`

---

## Custom Extensions (not in imgproxy)

These are video-specific options added by asset-proxy:

- [x] `framerate` / `fr` — output framerate
- [x] `trim` / `tr` — limit video duration (note: conflicts with imgproxy's `trim` for images)
