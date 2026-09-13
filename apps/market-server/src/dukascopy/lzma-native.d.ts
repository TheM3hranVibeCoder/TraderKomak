declare module "lzma-native" {
  const LZMA: {
    decompress(input: Buffer): Buffer;
    compress(input: Buffer): Buffer;
  };
  export default LZMA;
}
