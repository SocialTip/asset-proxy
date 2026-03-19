import type { ExternalImageService, ImageTransform } from "astro";
import {
  generateUrl,
  type UrlGeneratorConfig,
  type UrlGeneratorOptions,
} from "@socialtip/asset-proxy-url-generator";

export interface AssetProxyServiceConfig extends UrlGeneratorConfig {
  /** Base URL of the asset-proxy instance, e.g. `https://assets.example.com`. */
  baseUrl: string;
}

const QUALITY_PRESETS: Record<string, number> = {
  low: 30,
  mid: 50,
  high: 80,
  max: 100,
};

function mapFitToResizingType(
  fit: string | undefined,
): "fit" | "fill" | "force" | "fill-down" | undefined {
  switch (fit) {
    case "contain":
    case "scale-down":
      return "fit";
    case "cover":
      return "fill";
    case "fill":
      return "force";
    default:
      return undefined;
  }
}

function resolveQuality(
  quality: ImageTransform["quality"],
): number | undefined {
  if (quality === undefined || quality === null) return undefined;
  if (typeof quality === "number") return quality;
  return QUALITY_PRESETS[quality];
}

function resolveSrc(src: ImageTransform["src"]): string {
  if (typeof src === "string") return src;
  return src.src;
}

function mapFormat(
  format: ImageTransform["format"],
): UrlGeneratorOptions["outputFormat"] {
  if (!format) return undefined;
  if (format === "jpeg") return "jpg";
  return format as UrlGeneratorOptions["outputFormat"];
}

const service: ExternalImageService<AssetProxyServiceConfig> = {
  validateOptions(options) {
    if (!options.src) {
      throw new Error("The `src` property is required.");
    }
    return options;
  },

  getURL(options, imageConfig) {
    const config = imageConfig.service.config;
    const sourceUrl = resolveSrc(options.src);
    const quality = resolveQuality(options.quality);
    const format = mapFormat(options.format);
    const resizingType = mapFitToResizingType(options.fit);

    const generatorOptions: UrlGeneratorOptions = {
      sourceUrl,
    };

    if (options.width || options.height) {
      generatorOptions.resize = {
        type: resizingType ?? "fit",
        width: options.width ?? 0,
        height: options.height ?? 0,
      };
    }

    if (quality !== undefined) {
      generatorOptions.quality = quality;
    }

    if (format) {
      generatorOptions.outputFormat = format;
    }

    const path = generateUrl(generatorOptions, config);
    return `${config.baseUrl}${path}`;
  },

  getHTMLAttributes(options) {
    const attrs = { ...options } as Record<string, unknown>;
    delete attrs.src;
    delete attrs.width;
    delete attrs.height;
    delete attrs.format;
    delete attrs.quality;
    delete attrs.fit;
    delete attrs.position;
    return {
      ...attrs,
      loading: (attrs.loading as string) ?? "lazy",
      decoding: (attrs.decoding as string) ?? "async",
    };
  },
};

export default service;
