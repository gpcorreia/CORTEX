import sharp from "sharp";

/** Keep the whole edited image on the original canvas, without stretching or cropping it. */
export async function normalizedWebp(bytes, referenceBytes) {
  let image = sharp(bytes);
  const metadata = await image.metadata();
  if ((metadata.pages ?? 1) > 1)
    throw Error("Animações não podem ser convertidas como imagens estáticas.");
  if (referenceBytes) {
    const expected = await sharp(referenceBytes).metadata();
    if (
      (expected.pages ?? 1) > 1 ||
      !expected.width ||
      !expected.height ||
      !metadata.width ||
      !metadata.height
    )
      throw Error("É necessária uma referência estática válida.");
    const sameRatio =
      Math.abs(
        metadata.width / metadata.height / (expected.width / expected.height) -
          1,
      ) <= 1e-9;
    if (sameRatio)
      image = image.resize(expected.width, expected.height, { fit: "fill" });
    else {
      const transparent =
        expected.hasAlpha &&
        (
          await sharp(referenceBytes)
            .ensureAlpha()
            .extractChannel("alpha")
            .raw()
            .toBuffer()
        ).some((value) => value < 255);
      const resized = await image
        .resize(expected.width, expected.height, { fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const horizontal = expected.width - resized.info.width,
        vertical = expected.height - resized.info.height;
      image = sharp(resized.data, {
        raw: {
          width: resized.info.width,
          height: resized.info.height,
          channels: 4,
        },
      }).extend({
        left: Math.floor(horizontal / 2),
        right: Math.ceil(horizontal / 2),
        top: Math.floor(vertical / 2),
        bottom: Math.ceil(vertical / 2),
        extendWith: transparent ? "background" : "copy",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
  }
  if (metadata.orientation)
    image = image.withMetadata({ orientation: metadata.orientation });
  return image.webp({ lossless: true }).toBuffer();
}
