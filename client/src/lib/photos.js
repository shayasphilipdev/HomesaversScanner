// Compress an image File/Blob to a JPEG at most `maxWidth` wide.
// Keeps Supabase Storage usage low (typical phone photos 4–8 MB → ~150–300 KB).
export async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload  = () => res(i)
      i.onerror = () => rej(new Error('Image could not be read'))
      i.src     = url
    })

    const scale  = Math.min(1, maxWidth / img.width)
    const w      = Math.round(img.width  * scale)
    const h      = Math.round(img.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas produced no blob')),
        'image/jpeg',
        quality
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// crypto.randomUUID is supported in all modern browsers and CF Workers.
export const newPhotoNamespace = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
