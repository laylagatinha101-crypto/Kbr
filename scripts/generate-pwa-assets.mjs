import sharp from 'sharp'

const base = 'public/_gen'
const out = 'public'

// Ícones "any": redimensiona direto
for (const size of [192, 512]) {
  await sharp(`${base}/icon-base.png`)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(`${out}/icon-${size}.png`)
}

// Ícones maskable: conteúdo a 80% com padding na cor do tema (zona segura)
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.8)
  const pad = Math.round((size - inner) / 2)
  const innerBuf = await sharp(`${base}/icon-base.png`)
    .resize(inner, inner, { fit: 'cover' })
    .png()
    .toBuffer()
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 99, g: 102, b: 241, alpha: 1 },
    },
  })
    .composite([{ input: innerBuf, left: pad, top: pad }])
    .png()
    .toFile(`${out}/icon-${size}-maskable.png`)
}

// Screenshots nos tamanhos exatos do manifest
await sharp(`${base}/screenshot-mobile-base.png`)
  .resize(1072, 1920, { fit: 'cover' })
  .png()
  .toFile(`${out}/screenshot-mobile.png`)

await sharp(`${base}/screenshot-desktop-base.png`)
  .resize(1920, 1072, { fit: 'cover' })
  .png()
  .toFile(`${out}/screenshot-desktop.png`)

console.log('PWA assets gerados com sucesso')
