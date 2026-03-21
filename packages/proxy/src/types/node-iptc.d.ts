declare module "node-iptc" {
  function nodeIptc(buffer: Buffer): Record<string, string | string[]> | false;
  export default nodeIptc;
}
