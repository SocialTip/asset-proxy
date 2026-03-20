import {
  generateUrl,
  type UrlGeneratorOptions,
  type ParsedUrlInput,
} from "@socialtip/asset-proxy-url-generator";
import type { AssetProxyServiceConfig } from "./index.js";

export type GetImageUrlOptions = Partial<Omit<ParsedUrlInput, "sourceUrl">> & {
  src: string;
};

/** Generates a full asset-proxy URL for the given options and config. Useful as a standalone helper outside of Astro components. */
export function getImageUrl(
  options: GetImageUrlOptions,
  config: AssetProxyServiceConfig,
): string {
  const { src, ...proxyOptions } = options;

  const generatorOptions: UrlGeneratorOptions = {
    sourceUrl: src,
    ...proxyOptions,
  };

  const path = generateUrl(generatorOptions, config);
  return `${config.baseUrl}${path}`;
}
